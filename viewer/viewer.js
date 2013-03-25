/******************************************************************************/
/* viewer.js  -- The main moloch app
 *
 * Copyright 2012 AOL Inc. All rights reserved.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this Software except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/*jshint
  node: true, plusplus: false, curly: true, eqeqeq: true, immed: true, latedef: true, newcap: true, nonew: true, undef: true, strict: true, trailing: true
*/
"use strict";

var MIN_DB_VERSION = 5;

//// Modules
//////////////////////////////////////////////////////////////////////////////////
var Config         = require('./config.js'),
    express        = require('express'),
    connect        = require('connect'),
    connectTimeout = require('connect-timeout'),
    request        = require('request'),
    stylus         = require('stylus'),
    util           = require('util'),
    fs             = require('fs-ext'),
    async          = require('async'),
    url            = require('url'),
    dns            = require('dns'),
    decode         = require('./decode.js'),
    sprintf = require('./public/sprintf.js'),
    Db             = require('./db.js'),
    os             = require('os'),
    zlib           = require('zlib'),
    molochparser   = require('./molochparser.js'),
    passport       = require('passport'),
    DigestStrategy = require('passport-http').DigestStrategy,
    HTTPParser     = process.binding('http_parser').HTTPParser,
    molochversion  = require('./version'),
    httpAgent      = require('http'),
    httpsAgent     = require('https');

var app;
if (Config.isHTTPS()) {
  app = express.createServer({
    key: fs.readFileSync(Config.get("keyFile")),
    cert: fs.readFileSync(Config.get("certFile"))
  });
} else {
  app = express.createServer();
}

//////////////////////////////////////////////////////////////////////////////////
//// Config
//////////////////////////////////////////////////////////////////////////////////
var escInfo = Config.get("elasticsearch", "localhost:9200").split(':');

passport.use(new DigestStrategy({qop: 'auth', realm: Config.getFull("default", "httpRealm", "Moloch")},
  function(userid, done) {
    Db.get("users", "user", userid, function(err, suser) {
      if (err) {return done(err);}
      if (!suser || !suser.exists) {console.log(userid, "doesn't exist"); return done(null, false);}
      if (!suser._source.enabled) {console.log(userid, "not enabled"); return done("Not enabled");}

      return done(null, suser._source, {ha1: Config.store2ha1(suser._source.passStore)});
    });
  },
  function (options, done) {
      //TODO:  Should check nonce here
      return done(null, true);
  }
));


app.configure(function() {
  app.enable("jsonp callback");
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.set('view options', {molochversion: molochversion.version,
                           isIndex: false,
                           basePath: Config.basePath(),
                           elasticBase: "http://" + (escInfo[0] === "localhost"?os.hostname():escInfo[0]) + ":" + escInfo[1]
                          });

  app.use(express.favicon(__dirname + '/public/favicon.ico'));
  app.use(passport.initialize());
  app.use(function(req, res, next) {
    req.url = req.url.replace(Config.basePath(), "/");
    return next();
  });
  app.use(express.bodyParser());
  app.use(connectTimeout({ time: 30*60*1000 }));
  app.use(express.logger({ format: ':date \x1b[1m:method\x1b[0m \x1b[33m:url\x1b[0m :res[content-length] bytes :response-time ms' }));
  app.use(express.compress());
  app.use(express.methodOverride());
  app.use("/", express['static'](__dirname + '/public', { maxAge: 60 * 1000}));
  if (Config.get("passwordSecret")) {
    app.use(function(req, res, next) {

      // No auth for stats
      if (req.url.indexOf("/stats.json") === 0 || req.url.indexOf("/dstats.json") === 0) {
        return next();
      }

      // S2S Auth
      if (req.headers['x-moloch-auth']) {
        var obj = Config.auth2obj(req.headers['x-moloch-auth']);
        if (obj.path !== req.url) {
          console.log("ERROR - mismatch url", obj.path, req.url);
          return res.send("Unauthorized based on bad url, check logs on ", os.hostname());
        }
        if (Math.abs(Date.now() - obj.date) > 60000) { // Request has to be +- 60 seconds
          console.log("ERROR - Denying server to server based on timestamp, are clocks out of sync?");
          return res.send("Unauthorized based on timestamp - check that all moloch viewer machines have accurate clocks");
        }

        Db.get("users", "user", obj.user, function(err, suser) {
          if (err) {return res.send("ERROR - " +  err);}
          if (!suser || !suser.exists) {return res.send(obj.user + " doesn't exist");}
          if (!suser._source.enabled) {return res.send(obj.user + " not enabled");}
          req.user = suser._source;
          if (req.user.emailSearch === undefined) {req.user.emailSearch = false;}
          return next();
        });
        return;
      }

      // Header auth
      if (req.headers[Config.get("userNameHeader")] !== undefined) {
        var userName = req.headers[Config.get("userNameHeader")];
        Db.get("users", "user", userName, function(err, suser) {
          if (err) {return res.send("ERROR - " +  err);}
          if (!suser || !suser.exists) {return res.send(userName + " doesn't exist");}
          if (!suser._source.enabled) {return res.send(userName + " not enabled");}
          if (!suser._source.headerAuthEnabled) {return res.send(userName + " header auth not enabled");}
          req.user = suser._source;
          if (req.user.emailSearch === undefined) {req.user.emailSearch = false;}
          return next();
        });
        return;
      }

      // Browser auth
      req.url = req.url.replace("/", Config.basePath());
      passport.authenticate('digest', {session: false})(req, res, function (err) {
        req.url = req.url.replace(Config.basePath(), "/");
        if (err) {
          res.send(JSON.stringify({success: false, text: err}));
          return;
        } else {
          return next();
        }
      });
    });
  } else {
    /* Shared password isn't set, who cares about auth */
    app.use(function(req, res, next) {
      req.user = {userId: "anonymous", enabled: true, createEnabled: false, webEnabled: true, headerAuthEnabled: false, emailSearch: true};
      next();
    });
  }
});


function isEmptyObject(object) { for(var i in object) { return false; } return true; }
//////////////////////////////////////////////////////////////////////////////////
//// DB
//////////////////////////////////////////////////////////////////////////////////
Db.initialize({host : escInfo[0], port: escInfo[1]});

function deleteFile(node, id, path, cb) {
  fs.unlink(path, function() {
    Db.deleteDocument('files', 'file', id, function(err, data) {
      cb(null);
    });
  });
}

function isLocalView(node, yesCB, noCB) {
  Db.molochNodeStatsCache(node, function(err, stat) {
    if (err || stat.hostname !== os.hostname()) {
      noCB();
    } else {
      yesCB();
    }
  });
}

function dbCheck() {
  var index;

  ["stats", "dstats", "tags", "sequence", "files", "users"].forEach(function(index) {
    Db.status(index, function(err, status) {
      if (err || status.error) {
        console.log("ERROR - Issue with index '" + index + "' make sure 'db/db.pl <eshost:esport> init' has been run", err, status);
        process.exit(1);
      }
    });
  });

  Db.get("dstats", "version", "version", function(err, doc) {
    var version;
    if (!doc.exists) {
      version = 0;
    } else {
      version = doc._source.version;
    }

    if (version < MIN_DB_VERSION) {
        console.log("ERROR - Current database version (" + version + ") is less then required version (" + MIN_DB_VERSION + ") use 'db/db.pl <eshost:esport> upgrade' to upgrade");
        process.exit(1);
    }
  });

  if (Config.get("passwordSecret")) {
    Db.numberOfDocuments("users", function(err, num) {
      if (num === 0) {
        console.log("WARNING - No users are defined, use node viewer/addUser.js to add one, or turn off auth by unsetting passwordSecret");
      }
    });
  }
}

//////////////////////////////////////////////////////////////////////////////////
//// Pages
//////////////////////////////////////////////////////////////////////////////////
app.get("/", function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('index', {
    user: req.user,
    title: 'Home',
    isIndex: true
  });
});

app.get("/graph", function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('graph', {
    user: req.user,
    title: 'Graph',
    isIndex: true
  });
});

app.get('/about', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('about', {
    user: req.user,
    title: 'About'
  });
});

app.get('/files', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('files', {
    user: req.user,
    title: 'Files'
  });
});

app.get('/users', function(req, res) {
  if (!req.user.webEnabled || !req.user.createEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('users', {
    user: req.user,
    title: 'Users',
    token: Config.obj2auth({date: Date.now(), pid: process.pid, userId: req.user.userId})
  });
});

app.get('/password', function(req, res) {
  function render(user, cp) {
    res.render('password', {
      user: req.user,
      puser: user,
      currentPassword: cp,
      token: Config.obj2auth({date: Date.now(), pid: process.pid, userId: user.userId, cp:cp}),
      title: 'Change Password'
    });
  }

  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }

  if (req.query.userId) {
    Db.get("users", 'user', req.query.userId, function(err, user) {
      render(user._source, 0);
    });
  } else {
    render(req.user, 1);
  }
});

app.get('/stats', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }

  var query = {size: 100};

  Db.search('stats', 'stat', query, function(err, data) {
    var hits = data.hits.hits;
    var nodes = [];
    hits.forEach(function(hit) {
      nodes.push(hit._id);
    });
    nodes.sort();
    res.render('stats', {
      user: req.user,
      title: 'Stats',
      nodes: nodes
    });
  });
});

app.get('/:nodeName/statsDetail', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('statsDetail', {
    user: req.user,
    layout: false,
    nodeName: req.params.nodeName
  });
});

fs.unlink("./public/style.css"); // Remove old style.css file
app.get('/style.css', function(req, res) {
  fs.readFile("./views/style.styl", 'utf8', function(err, str) {
    if (err) {return console.log(err);}
    var style = stylus(str, "./views");
    style.render(function(err, css){
      if (err) {return console.log(err);}
      var date = new Date().toUTCString();
      res.setHeader('Content-Type', 'text/css');
      res.setHeader('Date', date);
      res.setHeader('Cache-Control', 'public, max-age=600');
      res.setHeader('Last-Modified', date);
      res.send(css);
    });
  });
});

//////////////////////////////////////////////////////////////////////////////////
//// EXPIRING
//////////////////////////////////////////////////////////////////////////////////
function statG(dir, func) {
  fs.statVFS(dir, function(err,stat) {
    var freeG = stat.f_frsize/1024.0*stat.f_bavail/(1024.0*1024.0);
    func(freeG);
  });
}

function expireOne (ourInfo, allInfo, minFreeG, pcapDir, nextCb) {

  var i;
  var nodes = [];

  // Find all the nodes that are on the same device
  for (i = 0; i < allInfo.length; i++) {
    if (allInfo[i].stat.dev === ourInfo.stat.dev) {
      nodes.push(allInfo[i].node);
    }
  }

  var query = { fields: [ 'num', 'name', 'first', 'size', 'node' ],
                from: '0',
                size: 10,
                query: { bool: {
                  must:     { terms: {node: nodes}},
                  must_not: { term: {locked: 1}}
                }},
                sort: { num: { order: 'asc' } } };

  var done = false;
  async.until(
    function () { // until test
      return done;
    },
    function (untilNextCb) { // until iterator
      Db.search('files', 'file', query, function(err, data) {
        console.log("expireOne result = \n", util.inspect(data, false, 12));
        if (err || data.error || data.hits.total <= query.size) {
          done = true;
          return untilNextCb();
        }

        async.forEachSeries(data.hits.hits, function(item, forNextCb) {
          statG(pcapDir, function(freeG) {
            console.log(freeG, "< ", minFreeG);
            if (freeG < minFreeG) {
              console.log("Deleting", item);
              deleteFile(item.fields.node, item._id, item.fields.name, forNextCb);
            } else {
              done = true;
              return forNextCb("Done");
            }
          });
        },
        function(err) {
          return untilNextCb();
        });
      });
    },
    function (err) {
      return nextCb();
    });
}

function expireCheckOne (ourInfo, allInfo, nextCb) {
  var node = ourInfo.node;
  var pcapDir = Config.getFull(node, "pcapDir");
  var freeSpaceG = Config.getFull(node, "freeSpaceG", 301);

  // Check if our pcap dir is full
  statG(pcapDir, function(freeG) {
    if (freeG < freeSpaceG) {
      expireOne(ourInfo, allInfo, freeSpaceG, pcapDir, nextCb);
    } else {
      nextCb();
    }
  });
}

function expireCheckAll () {
  // Find all the nodes running on this host
  Db.hostnameToNodeids(os.hostname(), function(nodes) {
    // Find all the pcap dirs for local nodes
    async.map(nodes, function (node, cb) {
      var pcapDir = Config.getFull(node, "pcapDir");
      fs.stat(pcapDir, function(err,stat) {
        cb(null, {node: node, stat: stat});
      });
    },
    function (err, allInfo) {
      // Now gow through all the local nodes and check them
      async.forEachSeries(allInfo, function (info, cb) {
        expireCheckOne(info, allInfo, cb);
      }, function (err) {
      });
    });
  });
}

//////////////////////////////////////////////////////////////////////////////////
//// APIs
//////////////////////////////////////////////////////////////////////////////////
function addSortToQuery(query, info, d) {
  if (!info || !info.iSortingCols || parseInt(info.iSortingCols, 10) === 0) {
    if (d) {
      if (!query.sort) {
        query.sort = [];
      }
      query.sort.push({});
      query.sort[query.sort.length-1][d] = {order: "asc"};
    }
    return;
  }

  if (!query.sort) {
    query.sort = [];
  }

  var i;
  for (i = 0; i < parseInt(info.iSortingCols, 10); i++) {
    if (!info["iSortCol_" + i] || !info["sSortDir_" + i] || !info["mDataProp_" + info["iSortCol_" + i]]) {
      continue;
    }

    var obj = {};
    var field = info["mDataProp_" + info["iSortCol_" + i]];
    obj[field] = {order: info["sSortDir_" + i]};
    query.sort.push(obj);
    if (field === "fp") {
      query.sort.push({fpms: {order: info["sSortDir_" + i]}});
    } else if (field === "lp") {
      query.sort.push({lpms: {order: info["sSortDir_" + i]}});
    }
  }
  console.log(query.sort);
}

function noCache(req, res) {
  res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
}

app.get('/esstats.json', function(req, res) {
  var stats = [];

  Db.nodesStats({"jvm": 1}, function(err, info) {
    var nodes = Object.keys(info.nodes);
    for (var n = 0; n < nodes.length; n++) {
      var node = info.nodes[nodes[n]];
      stats.push({
        name: node.name,
        storeSize: node.indices.store.size_in_bytes,
        docs: node.indices.docs.count,
        searches: node.indices.search.query_total,
        searchesTime: node.indices.search.query_time_in_millis,
        heapSize: node.jvm.mem.heap_used_in_bytes,
        nonHeapSize: node.jvm.mem.non_heap_used_in_bytes
      });
    }
    var r = {sEcho: req.query.sEcho,
             iTotalRecords: stats.length,
             iTotalDisplayRecords: stats.length,
             aaData: stats};
    res.send(r);
  });
});

app.get('/stats.json', function(req, res) {
  noCache(req, res);

  var columns = ["", "_id", "currentTime", "totalPackets", "totalK", "totalSessions", "monitoring", "freeSpaceM", "deltaPackets", "deltaBytes", "deltaSessions", "deltaDropped", "deltaMS"];
  var limit = (req.query.iDisplayLength?Math.min(parseInt(req.query.iDisplayLength, 10),10000):500);

  var query = {fields: columns,
               from: req.query.iDisplayStart || 0,
               size: limit,
               script_fields: {
                 deltaBytesPerSec: {script :"floor(_source.deltaBytes * 1000.0/_source.deltaMS)"},
                 deltaPacketsPerSec: {script :"floor(_source.deltaPackets * 1000.0/_source.deltaMS)"},
                 deltaSessionsPerSec: {script :"floor(_source.deltaSessions * 1000.0/_source.deltaMS)"},
                 deltaDroppedPerSec: {script :"floor(_source.deltaDropped * 1000.0/_source.deltaMS)"}
               }
              };
  addSortToQuery(query, req.query, "_uid");
  console.log("stats query", JSON.stringify(query));

  async.parallel({
    stats: function (cb) {
      Db.search('stats', 'stat', query, function(err, result) {
        var i;
        if (err || result.error) {
          res.send({total: 0, results: []});
        } else {
          var results = {total: result.hits.total, results: []};
          for (i = 0; i < result.hits.hits.length; i++) {
            result.hits.hits[i].fields.id = result.hits.hits[i]._id;
            results.results.push(result.hits.hits[i].fields);
          }
          cb(null, results);
        }
      });
    },
    total: function (cb) {
      Db.numberOfDocuments('stats', cb);
    }
  },
  function(err, results) {
    var r = {sEcho: req.query.sEcho,
             iTotalRecords: results.total,
             iTotalDisplayRecords: results.stats.total,
             aaData: results.stats.results};
    res.send(r);
  });
});

app.get('/dstats.json', function(req, res) {
  noCache(req, res);

  var query = {size: req.query.size || 1440,
               sort: { currentTime: { order: 'desc' } },
               query: {
                 filtered: {
                   query: {
                     match_all: {}
                   },
                   filter: {
                     and: [
                       {
                         term: { nodeName: req.query.nodeName}
                       },
                       {
                         numeric_range: { currentTime: { from: req.query.start, to: req.query.stop } }
                       },
                       {
                         term: { interval: req.query.interval || 60}
                       }
                     ]
                   }
                 }
               },
               fields: ["currentTime", req.query.name],
               script_fields: {
                 deltaBits: {script :"floor(_source.deltaBytes * 8.0)"},
                 deltaBytesPerSec: {script :"floor(_source.deltaBytes * 1000.0/_source.deltaMS)"},
                 deltaBitsPerSec: {script :"floor(_source.deltaBytes * 1000.0/_source.deltaMS * 8)"},
                 deltaPacketsPerSec: {script :"floor(_source.deltaPackets * 1000.0/_source.deltaMS)"},
                 deltaSessionsPerSec: {script :"floor(_source.deltaSessions * 1000.0/_source.deltaMS)"},
                 deltaDroppedPerSec: {script :"floor(_source.deltaDropped * 1000.0/_source.deltaMS)"}
               }
              };

  Db.search('dstats', 'dstat', query, function(err, result) {
    var i;
    var data = [];
    data[query.size] = 0;
    var num = (req.query.stop - req.query.start)/req.query.step;

    for (i = 0; i < num; i++) {
      data[i] = 0;
    }

    var mult = 1;
    if (req.query.name === "freeSpaceM") {
      mult = 1000000;
    }

    if (result && result.hits) {
      for (i = 0; i < result.hits.hits.length; i++) {
        var pos = Math.floor((result.hits.hits[i].fields.currentTime - req.query.start)/req.query.step);
        data[pos] = mult*result.hits.hits[i].fields[req.query.name];
      }
    }
    res.send(data);
  });
});

app.get('/files.json', function(req, res) {
  noCache(req, res);

  var columns = ["num", "node", "name", "locked", "first", "size"];
  var limit = (req.query.iDisplayLength?Math.min(parseInt(req.query.iDisplayLength, 10),10000):500);

  var query = {fields: columns,
               from: req.query.iDisplayStart || 0,
               size: limit
              };

  addSortToQuery(query, req.query, "num");

  async.parallel({
    files: function (cb) {
      Db.search('files', 'file', query, function(err, result) {
        var i;

        if (err || result.error) {
          return cb(err || result.error);
        }

        var results = {total: result.hits.total, results: []};
        for (i = 0; i < result.hits.hits.length; i++) {
          if (result.hits.hits[i].fields.locked === undefined) {
            result.hits.hits[i].fields.locked = 0;
          }
          result.hits.hits[i].fields.id = result.hits.hits[i]._id;
          results.results.push(result.hits.hits[i].fields);
        }

        async.forEach(results.results, function (item, cb) {
          fs.stat(item.name, function (err, stats) {
            if (err || !stats) {
              item.size = -1;
            } else {
              item.size = stats.size/1000000.0;
            }
            cb(null);
          });
        }, function (err) {
          cb(null, results);
        });
      });
    },
    total: function (cb) {
      Db.numberOfDocuments('files', cb);
    }
  },
  function(err, results) {
    if (err) {
      return res.send({total: 0, results: []});
    }

    var r = {sEcho: req.query.sEcho,
             iTotalRecords: results.total,
             iTotalDisplayRecords: results.files.total,
             aaData: results.files.results};
    res.send(r);
  });
});

app.post('/users.json', function(req, res) {
  var fields = ["userId", "userName", "expression", "enabled", "createEnabled", "webEnabled", "headerAuthEnabled", "emailSearch"];
  var limit = (req.body.iDisplayLength?Math.min(parseInt(req.body.iDisplayLength, 10),10000):500);

  var query = {fields: fields,
               from: req.body.iDisplayStart || 0,
               size: limit
              };

  addSortToQuery(query, req.body, "userId");

  async.parallel({
    users: function (cb) {
      Db.search('users', 'user', query, function(err, result) {
        var i;

        if (err || result.error) {
          res.send({total: 0, results: []});
        } else {
          var results = {total: result.hits.total, results: []};
          for (i = 0; i < result.hits.hits.length; i++) {
            result.hits.hits[i].fields.id = result.hits.hits[i]._id;
            result.hits.hits[i].fields.expression = result.hits.hits[i].fields.expression || "";
            result.hits.hits[i].fields.headerAuthEnabled = result.hits.hits[i].fields.headerAuthEnabled || false;
            result.hits.hits[i].fields.emailSearch = result.hits.hits[i].fields.emailSearch || false;
            results.results.push(result.hits.hits[i].fields);
          }
          cb(null, results);
        }
      });
    },
    total: function (cb) {
      Db.numberOfDocuments('users', cb);
    }
  },
  function(err, results) {
    var r = {sEcho: req.body.sEcho,
             iTotalRecords: results.total,
             iTotalDisplayRecords: results.users.total,
             aaData: results.users.results};
    res.send(r);
  });
});

function twoDigitString(value) {
  return (value < 10) ? ("0" + value) : value.toString();
}

function getIndices(startTime, stopTime, cb) {
  var indices = [];
  startTime = Math.floor(startTime/86400)*86400;
  Db.status("sessions-*", function(err, status) {

    if (err || status.error) {
      return cb("");
    }

    var rotateIndex = Config.get("rotateIndex", "daily");

    while (startTime < stopTime) {
      var iname;
      var d = new Date(startTime*1000);
      var jan = new Date(d.getUTCFullYear(), 0, 0);
      if (rotateIndex === "monthly") {
        iname = "sessions-" +
          twoDigitString(d.getUTCFullYear()%100) + 'm' +
          twoDigitString(d.getUTCMonth()+1);
      } else if (rotateIndex === "weekly") {
        iname = "sessions-" +
          twoDigitString(d.getUTCFullYear()%100) + 'w' +
          twoDigitString(Math.floor((d - jan) / 604800000));
      } else {
        iname = "sessions-" +
          twoDigitString(d.getUTCFullYear()%100) +
          twoDigitString(d.getUTCMonth()+1) +
          twoDigitString(d.getUTCDate());
      }

      if (status.indices[iname] && (indices.length === 0 || iname !== indices[indices.length-1])) {
        indices.push(iname);
      }
      startTime += 86400;
    }

    if (indices.length === 0) {
      return cb("sessions-*");
    }

    return cb(indices.join());
  });
}

/* async convert tag strings to numbers in an already built query */
function lookupQueryTags(query, doneCb) {
  var outstanding = 0;
  var finished = 0;

  function process(parent, obj, item) {
    if ((item === "ta" || item === "hh" || item === "hh1" || item === "hh2") && typeof obj[item] === "string") {
      if (obj[item].indexOf("*") !== -1) {
        delete parent.term;
        outstanding++;
        var query;
        if (item === "ta") {
          query = {bool: {must: {wildcard: {_id: obj[item]}},
                          must_not: {wildcard: {_id: "http:header:*"}}
                         }
                  };
        } else {
          query = {wildcard: {_id: "http:header:" + obj[item].toLowerCase()}};
        }
        Db.search('tags', 'tag', {size:500, fields:["id", "n"], query: query}, function(err, result) {
          var terms = [];
          result.hits.hits.forEach(function (hit) {
            terms.push(hit.fields.n);
          });
          parent.terms = {};
          parent.terms[item] = terms;
          outstanding--;
          if (finished && outstanding === 0) {
            doneCb();
          }
        });
      } else {
        outstanding++;
        var tag = (item !== "ta"?"http:header:" + obj[item].toLowerCase():obj[item]);

        Db.tagNameToId(tag, function (id) {
          obj[item] = id;
          outstanding--;
          if (finished && outstanding === 0) {
            doneCb();
          }
        });
      }
    } else if (typeof obj[item] === "object") {
      convert(obj, obj[item]);
    }
  }



  function convert(parent, obj) {
    for (var item in obj) {
      process(parent, obj, item);
    }
  }

  convert(null, query);
  if (outstanding === 0) {
    return doneCb();
  }

  finished = 1;
}

function buildSessionQuery(req, buildCb) {
  var columns = ["pr", "ro", "db", "fp", "lp", "a1", "p1", "a2", "p2", "pa", "by", "no", "us", "g1", "g2", "esub", "esrc", "edst", "efn"];
  var limit = (req.query.iDisplayLength?Math.min(parseInt(req.query.iDisplayLength, 10),100000):100);
  var i;


  var query = {fields: columns,
               from: req.query.iDisplayStart || 0,
               size: limit,
               query: {filtered: {query: {}}}
              };

  if (req.query.facets) {
    query.facets = {
                     dbHisto: {histogram : {key_field: "lp", value_field: "db", interval: 60, size:1440}},
                     paHisto: {histogram : {key_field: "lp", value_field: "pa", interval: 60, size:1440}},
                     map1: {terms : {field: "g1", size:1000}},
                     map2: {terms : {field: "g2", size:1000}}
                   };
  }


  if (req.query.date && req.query.date === '-1') {
    query.query.filtered.query.match_all = {};
  } else if (req.query.startTime && req.query.stopTime) {
    if (! /^[0-9]+$/.test(req.query.startTime)) {
      req.query.startTime = Date.parse(req.query.startTime.replace("+", " "))/1000;
    } else {
      req.query.startTime = parseInt(req.query.startTime, 10);
    }

    if (! /^[0-9]+$/.test(req.query.stopTime)) {
      req.query.stopTime = Date.parse(req.query.stopTime.replace("+", " "))/1000;
    } else {
      req.query.stopTime = parseInt(req.query.stopTime, 10);
    }
    query.query.filtered.query.range = {lp: {gte: req.query.startTime, lte: req.query.stopTime}};
  } else {
    if (!req.query.date) {
      req.query.date = 1;
    }
    req.query.startTime = (Math.floor(Date.now() / 1000) - 60*60*parseInt(req.query.date, 10));
    req.query.stopTime = Date.now()/1000;
    query.query.filtered.query.range = {lp: {from: req.query.startTime}};
  }

  addSortToQuery(query, req.query, "fp");

  var err = null;
  molochparser.parser.yy = {emailSearch: req.user.emailSearch === true};
  if (req.query.expression) {
    try {
      query.query.filtered.filter = molochparser.parse(req.query.expression);
    } catch (e) {
      err = e;
    }
  }

  // Expression was set by admin, so assume email search ok
  molochparser.parser.yy = {emailSearch: true};
  if (req.user.expression && req.user.expression.length > 0) {
    try {
      var userExpression = molochparser.parse(req.user.expression);
      if (query.query.filtered.filter === undefined) {
        query.query.filtered.filter = userExpression;
      } else {
        query.query.filtered.filter = {and: [userExpression, query.query.filtered.filter]};
      }
    } catch (e) {
      console.log("ERR - User expression doesn't compile", req.user.expression, e);
    }
  }

  lookupQueryTags(query.query.filtered, function () {
    if (req.query.date && req.query.date === '-1') {
      return buildCb(err, query, "sessions*");
    }

    getIndices(req.query.startTime, req.query.stopTime, function(indices) {
      return buildCb(err, query, indices);
    });
  });
}

app.get('/sessions.json', function(req, res) {
  var map = {};
  var lpHisto = [];
  var dbHisto = [];
  var paHisto = [];
  var i;

  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {sEcho: req.query.sEcho,
               iTotalRecords: 0,
               iTotalDisplayRecords: 0,
               lpHisto: {entries: []},
               dbHisto: {entries: []},
               bsqErr: bsqErr.toString(),
               map: [],
               aaData:[]};
      res.send(r);
      return;
    }
    console.log("sessions.json query", JSON.stringify(query));

    async.parallel({
      sessions: function (sessionsCb) {
        Db.searchPrimary(indices, 'session', query, function(err, result) {
          //console.log("sessions query = ", util.inspect(result, false, 50));
          if (err || result.error) {
            console.log("sessions.json error", err);
            sessionsCb(null, {total: 0, results: []});
            return;
          }

          if (!result.facets) {
            result.facets = {map1: {terms: []}, map2: {terms: []}, dbHisto: {entries: []}, paHisto: {entries: []}};
          }

          result.facets.dbHisto.entries.forEach(function (item) {
            lpHisto.push([item.key*1000, item.count]);
            dbHisto.push([item.key*1000, item.total]);
          });

          result.facets.paHisto.entries.forEach(function (item) {
            paHisto.push([item.key*1000, item.total]);
          });

          result.facets.map1.terms.forEach(function (item) {
            if (item.count < 0) {
              item.count = 0x7fffffff;
            }
            map[item.term] = item.count;
          });

          result.facets.map2.terms.forEach(function (item) {
            if (item.count < 0) {
              item.count = 0x7fffffff;
            }
            if (!map[item.term]) {
              map[item.term] = 0;
            }
            map[item.term] += item.count;
          });

          var results = {total: result.hits.total, results: []};
          for (i = 0; i < result.hits.hits.length; i++) {
            if (!result.hits.hits[i] || !result.hits.hits[i].fields) {
              continue;
            }
            result.hits.hits[i].fields.index = result.hits.hits[i]._index;
            result.hits.hits[i].fields.id = result.hits.hits[i]._id;
            results.results.push(result.hits.hits[i].fields);
          }
          sessionsCb(null, results);
        });
      },
      total: function (totalCb) {
        Db.numberOfDocuments('sessions-*', totalCb);
      },
      health: function (healthCb) {
        Db.healthCache(healthCb);
      }
    },
    function(err, results) {
      console.log("total = ", results.total, "display total = ", (results.sessions?results.sessions.total:0));
      var r = {sEcho: req.query.sEcho,
               iTotalRecords: results.total,
               iTotalDisplayRecords: (results.sessions?results.sessions.total:0),
               lpHisto: lpHisto,
               dbHisto: dbHisto,
               paHisto: paHisto,
               health: results.health,
               map: map,
               aaData: (results.sessions?results.sessions.results:[])};
      try {
        res.send(r);
      } catch (c) {
      }
    });
  });
});

app.get('/dns.json', function(req, res) {
  console.log("dns.json", req.query);
  dns.reverse(req.query.ip, function (err, data) {
    if (err) {
      return res.send({hosts: []});
    }
    return res.send({hosts: data});
  });
});

app.get('/graph.json', function(req, res) {

  req.query.iDisplayLength = req.query.iDisplayLength || "5000";
  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {};
      res.send(r);
      return;
    }
    console.log("graph.json indices", indices, " query", JSON.stringify(query));

    async.parallel({
      health: function (healthCb) {
        Db.healthCache(healthCb);
      },
      graph: function (graphCb) {
        Db.searchPrimary(indices, 'session', query, graphCb);
      }
    },
    function(err, results) {
      if (err || results.graph.error) {
        console.log("graph.json error", err, results.graph.error);
        res.send({});
        return;
      }

      var nodesHash = {};
      var nodes = [];
      var connects = {};
      var numNodes = 1;

      var i;
      for (i = 0; i < results.graph.hits.hits.length; i++) {
        if (!results.graph.hits.hits[i] || !results.graph.hits.hits[i].fields) {
          continue;
        }

        var f = results.graph.hits.hits[i].fields;
        var a1, a2, g1, g2;
        if (req.query.useDir === "1"|| f.a1 < f.a2) {
          a1 = decode.inet_ntoa(f.a1);
          a2 = decode.inet_ntoa(f.a2);
          g1 = f.g1;
          g2 = f.g2;
          if (req.query.usePort === "1") {
            a2 += ":" + f.p2;
          }
          if (req.query.useDir === "1") {
            a1 = "src:" + a1;
            a2 = "dst:" + a2;
          }
        } else {
          a1 = decode.inet_ntoa(f.a2);
          a2 = decode.inet_ntoa(f.a1);
          g1 = f.g2;
          g2 = f.g1;
          if (req.query.usePort === "1") {
            a1 += ":" + f.p2;
          }
        }

        if (nodesHash[a1] === undefined) {
          nodesHash[a1] = nodes.length;
          nodes.push({id: a1, g: g1, db: 0, by: 0, pa: 0});
        }

        if (nodesHash[a2] === undefined) {
          nodesHash[a2] = nodes.length;
          nodes.push({id: a2, g: g2, db: 0, by: 0, pa: 0});
        }

        var a1p = nodesHash[a1];
        var a2p = nodesHash[a2];
        nodes[a1p].by += f.by;
        nodes[a1p].db += f.db;
        nodes[a1p].pa += f.pa;
        nodes[a2p].by += f.by;
        nodes[a2p].db += f.db;
        nodes[a2p].pa += f.pa;


        var n = "" + a1 + "," + a2;
        if (connects[n] === undefined) {
          connects[n] = {value: 0, source: nodesHash[a1], target: nodesHash[a2], pr: 0, by: 0, db: 0, pa: 0, no: {}};
        }

        connects[n].value++;
        connects[n].by += f.by;
        connects[n].db += f.db;
        connects[n].pa += f.pa;
        connects[n].no[f.no] = 1;
      }

      var links = [];
      for (var key in connects) {
        links.push(connects[key]);
      }

      res.send({health: results.health, nodes: nodes, links: links});
    });
  });
});

app.get('/sessions.csv', function(req, res) {
  res.setHeader("Content-Type", "text/csv");

  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      res.send("#Error " + bsqErr.toString() + "\r\n");
      return;
    }

    Db.searchPrimary(indices, 'session', query, function(err, result) {
      if (err || result.error) {
        console.log("sessions.csv error", err);
        res.send("#Error db\r\n");
        return;
      }

      res.write("Protocol, First Packet, Last Packet, Source IP, Source Port, Source Geo, Destination IP, Destination Port, Destination Geo, Packets, Bytes, Data Bytes, Node\r\n");
      var i;
      for (i = 0; i < result.hits.hits.length; i++) {
        if (!result.hits.hits[i] || !result.hits.hits[i].fields) {
          continue;
        }
        var f = result.hits.hits[i].fields;
        var pr;
        switch (f.pr) {
        case 1:
          pr = "icmp";
          break;
        case 6:
          pr = "tcp";
          break;
        case 17:
          pr =  "udp";
          break;
        }

        res.write(pr + ", " + f.fp + ", " + f.lp + ", " + decode.inet_ntoa(f.a1) + ", " + f.p1 + ", " + (f.g1||"") + ", "  + decode.inet_ntoa(f.a2) + ", " + f.p2 + ", " + (f.g2||"") + ", " + f.pa + ", " + f.by + ", " + f.db + ", " + f.no + "\r\n");
      }
      res.end();
    });
  });
});

app.get('/uniqueValue.json', function(req, res) {
  noCache(req, res);
  var query;

  if (req.query.type === "tags") {
    query = {bool: {must: {wildcard: {_id: req.query.filter + "*"}},
                  must_not: {wildcard: {_id: "http:header:*"}}
                     }
          };
  } else {
    query = {wildcard: {_id: "http:header:" + req.query.filter + "*"}};
  }

  console.log("uniqueValue query", JSON.stringify(query));
  Db.search('tags', 'tag', {size:200, query: query}, function(err, result) {
    var terms = [];
    if (req.query.type === "tags") {
      result.hits.hits.forEach(function (hit) {
        terms.push(hit._id);
      });
    } else {
      result.hits.hits.forEach(function (hit) {
        terms.push(hit._id.substring(12));
      });
    }
    res.send(terms);
  });
});

app.get('/unique.txt', function(req, res) {
  if (req.query.field === undefined) {
    return res.send("Missing field parameter");
  }

  noCache(req, res);
  var doCounts = parseInt(req.query.counts, 10) || 0;
  var doIp =  (req.query.field === "a1" || req.query.field === "a2");

  buildSessionQuery(req, function(err, query, indices) {
    query.fields = [req.query.field];

    /* Any multi value string field must be uniqued here or elastic 0.18/0.19/0.20 will blow up */
    if (req.query.field.match(/^(us|esub|edst|esrc|efn)$/)) {
      query.size = 200000;
      if (query.query.filtered.filter === undefined) {
        query.query.filtered.filter = {exists: {field: req.query.field}};
      } else {
        query.query.filtered.filter = {and: [query.query.filtered.filter, {exists: {field: req.query.field}}]};
      }
    } else {
      query.facets = {facets: { terms : {field : req.query.field, size: 1000000}}};
      query.size = 0;
    }

    console.log("unique query", indices, JSON.stringify(query));

    Db.searchPrimary(indices, 'session', query, function(err, result) {
      //console.log("unique result", util.inspect(result, false, 100));
      if (req.query.field.match(/^(us|esub|edst|esrc|efn)$/)) {
        var counts = {};
        var keys = [];
        result.hits.hits.forEach(function (item) {
          if (!item.fields || !item.fields[req.query.field]) {
            return;
          }
          item.fields[req.query.field].forEach(function (aitem) {
            if (counts[aitem]) {
              counts[aitem]++;
            } else {
              counts[aitem] = 1;
              keys.push(aitem);
            }
          });
        });

        if (doCounts) {
          keys = keys.sort(function(a,b) {return counts[b] - counts[a];});
        }

        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (doCounts) {
            res.write(counts[key] + ", ");
          }
          res.write(key +"\n");
        }
        res.end();
        return;
      }

      result.facets.facets.terms.forEach(function (item) {
        if (doIp) {
          res.write(decode.inet_ntoa(item.term));
        } else {
          res.write(item.term);
        }

        if (doCounts) {
          res.write(", " + item.count);
        }
        res.write("\n");
      });
      res.end();
    });
  });
});

function processSessionId(id, headerCb, packetCb, endCb, maxPackets) {
  function processFile(fd, pos, nextCb) {
    var buffer = new Buffer(5000);
    try {
      fs.read(fd, buffer, 0, 16, pos, function (err, bytesRead, buffer) {
        if (bytesRead !== 16) {
          return packetCb(buffer.slice(0,0), nextCb);
        }
        var len = buffer.readInt32LE(8);
        fs.read(fd, buffer, 16, len, pos+16, function (err, bytesRead, buffer) {
          return packetCb(buffer.slice(0,16+len), nextCb);
        });
      });
    } catch (e) {
      console.log("Error ", e, "for id", id);
      endCb("Error loading data for session " + id, null);
    }
  }

  Db.get('sessions-' + id.substr(0,id.indexOf('-')), 'session', id, function(err, session) {
    if (err || !session.exists) {
      endCb("Not Found", null);
      return;
    }

    if (maxPackets && session._source.ps.length > maxPackets) {
      session._source.ps.length = maxPackets;
    }

    /* Old Format: Every item in array had file num (top 28 bits) and file pos (lower 36 bits)
     * New Format: Negative numbers are file numbers until next neg number, otherwise file pos */
    var newFormat = false;
    var file;
    var openFile = -1;
    var openHandle = null;
    async.forEachSeries(session._source.ps, function(item, nextCb) {
      var pos;

      if (item < 0) {
        newFormat = true;
        file = item * -1;
        return nextCb();
      } else if (newFormat) {
        pos  = item;
      } else  {
        // javascript doesn't have 64bit bitwise operations
        file = Math.floor(item / 0xfffffffff);
        pos  = item % 0x1000000000;
      }

      if (file !== openFile) {
        if (openFile !== -1) {
          if (openHandle) {
            fs.close(openHandle);
          }
        }

        Db.get('files', 'file', session._source.no + '-' + file, function (err, fresult) {
          if (err || !fresult._source) {
            console.log("ERROR - Not found", session._source.no + '-' + file, fresult);
            nextCb("ERROR - Not found", session._source.no + '-' + file);
            return;
          }
          fs.open(fresult._source.name, "r", function (err, fd) {
            if (err) {
              console.log("ERROR - Couldn't open file ", err);
              nextCb("ERROR - Couldn't open file " + err);
            }
            if (openFile === -1 && headerCb) {
              var hbuffer = new Buffer(24);
              fs.readSync(fd, hbuffer, 0, 24, 0);
              headerCb(hbuffer);
            }
            openHandle = fd;
            processFile(openHandle, pos, nextCb);
            openFile = file;
          });
        });
      } else {
        processFile(openHandle, pos, nextCb);
      }
    },
    function (err, results)
    {
      if (openHandle) {
        fs.close(openHandle);
      }

      async.parallel([
        function(parallelCb) {
          if (!session._source.ta) {
            session._source.ta = [];
            return parallelCb(null);
          }
          async.map(session._source.ta, function (item, cb) {
            Db.tagIdToName(item, function (name) {
              cb(null, name);
            });
          },
          function(err, results) {
            session._source.ta = results;
            parallelCb(null);
          });
        },
        function(parallelCb) {
          if (!session._source.hh) {
            return parallelCb(null);
          }
          async.map(session._source.hh, function (item, cb) {
            Db.tagIdToName(item, function (name) {
              cb(null, name.substring(12));
            });
          },
          function(err, results) {
            session._source.hh = results;
            parallelCb(null);
          });
        },
        function(parallelCb) {
          if (!session._source.hh1) {
            return parallelCb(null);
          }
          async.map(session._source.hh1, function (item, cb) {
            Db.tagIdToName(item, function (name) {
              cb(null, name.substring(12));
            });
          },
          function(err, results) {
            session._source.hh1 = results;
            parallelCb(null);
          });
        },
        function(parallelCb) {
          if (!session._source.hh2) {
            return parallelCb(null);
          }
          async.map(session._source.hh2, function (item, cb) {
            Db.tagIdToName(item, function (name) {
              cb(null, name.substring(12));
            });
          },
          function(err, results) {
            session._source.hh2 = results;
            parallelCb(null);
          });
        }],
        function(err, results) {
          endCb(null, session._source);
        }
      );
    });
  });
}

function safeStr(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/\'/g, '&#39;');
}

// Some ideas from hexy.js
function toHex(input, offsets) {
  var out = "";
  var i;

  for (var pos = 0; pos < input.length; pos += 16) {
    var line = input.slice(pos, Math.min(pos+16, input.length));
    if (offsets) {
      out += sprintf.sprintf("<span class=\"sessionln\">%08d:</span> ", pos);
    }

    for (i = 0; i < 16; i++) {
      if (i % 2 === 0 && i > 0) {
        out += " ";
      }
      if (i < line.length) {
        out += sprintf.sprintf("%02x", line[i]);
      } else {
        out += "  ";
      }
    }

    out += " ";

    for (i = 0; i < line.length; i++) {
      if (line[i] <= 32 || line[i]  > 128) {
        out += ".";
      } else {
        out += safeStr(line.toString("ascii", i, i+1));
      }
    }
    out += "\n";
  }
  return out;
}

function localSessionDetailReturnFull(req, res, session, incoming) {
  var outgoing = [];
  for (var r = 0; r < incoming.length; r++) {
    outgoing[r]= {html: ""};
    for (var p = 0; p < incoming[r].pieces.length; p++) {
      if (req.query.base === "hex") {
        outgoing[r].html += '<pre>' + toHex(incoming[r].pieces[p].raw, req.query.line === "true") + '</pre>';
      } else if (req.query.base === "ascii") {
        outgoing[r].html += '<pre>' + safeStr(incoming[r].pieces[p].raw.toString("binary")) + '</pre>';
      } else if (req.query.base === "utf8") {
        outgoing[r].html += '<pre>' + safeStr(incoming[r].pieces[p].raw.toString("utf8")) + '</pre>';
      } else {
        outgoing[r].html += safeStr(incoming[r].pieces[p].raw.toString()).replace(/\r?\n/g, '<br>');
      }

      if(incoming[r].pieces[p].bodyNum !== undefined) {
        var url = req.params.nodeName + "/" + 
                  session.id + "/body/" + 
                  incoming[r].pieces[p].bodyType + "/" + 
                  incoming[r].pieces[p].bodyNum + "/" + 
                  incoming[r].pieces[p].bodyName + ".pellet";

        if (incoming[r].pieces[p].bodyType === "image") {
          outgoing[r].html += "<img src=\"" + url + "\">";
        } else {
          outgoing[r].html += "<a href=\"" + url + "\">" + incoming[r].pieces[p].bodyName + "</a>";
        }
      }
    }
  }

  res.render('sessionDetail', {
    user: req.user,
    layout: false,
    session: session,
    data: outgoing,
    query: req.query
  });
}


// Needs to be rewritten, this sucks
function gzipDecode(req, res, session, incoming) {
  var kind;

  var outgoing = [];

  if (incoming[0].data.slice(0,4).toString() === "HTTP") {
    kind = [HTTPParser.RESPONSE, HTTPParser.REQUEST];
  } else {
    kind = [HTTPParser.REQUEST, HTTPParser.RESPONSE];
  }
  var parsers = [new HTTPParser(kind[0]), new HTTPParser(kind[1])];

  parsers[0].onBody = parsers[1].onBody = function(buf, start, len) {
    var pos = this.pos;

    // This isn't a gziped request
    if (!this.gzip) {
      outgoing[pos] = {pieces:[{raw: buf}]};
      return;
    }

    // Copy over the headers
    if (!outgoing[pos]) {
      outgoing[pos] = {pieces:[{raw: buf.slice(0, start)}]};
    }

    if (!this.inflator) {
      this.inflator = zlib.createGunzip()
        .on("data", function (b) {
          var tmp = Buffer.concat([outgoing[pos].pieces[0].raw, new Buffer(b)]);
          outgoing[pos].pieces[0].raw = tmp;
        })
        .on("error", function (e) {
        })
        .on("end", function () {
        });
    }

    this.inflator.write(buf.slice(start,start+len));
  };

  parsers[0].onMessageComplete = parsers[1].onMessageComplete = function() {
    //console.log("onMessageComplete", this.pos, this.gzip);
    var pos = this.pos;

    if (this.pos > 0) {
      parsers[(this.pos+1)%2].reinitialize(kind[(this.pos+1)%2]);
    }

    var nextCb = this.nextCb;
    this.nextCb = null;
    if (this.inflator) {
      this.inflator.end(null, function () {
        process.nextTick(nextCb);
      });
      this.inflator = null;
    } else {
      outgoing[pos] = {pieces: [{raw: incoming[pos].data}]};
      process.nextTick(nextCb);
    }
  };

  parsers[0].onHeadersComplete = parsers[1].onHeadersComplete = function(info) {
    var h;
    this.gzip = false;
    for (h = 0; h < info.headers.length; h += 2) {
      if (info.headers[h].match(/Content-Encoding/i)) {
        if (info.headers[h+1].match(/gzip/i)) {
          this.gzip = true;
        }
        break;
      }
    }
  };

  var p = 0;
  async.forEachSeries(incoming, function(item, nextCb) {
    var pos = p;
    p++;
    parsers[(pos%2)].pos = pos;

    if (!item) {
    } else if (item.data.length === 0) {
      outgoing[pos] = {pieces:[{raw: item.data}]};
      process.nextTick(nextCb);
    } else {
      parsers[(pos%2)].nextCb = nextCb;
      var out = parsers[(pos%2)].execute(item.data, 0, item.data.length);
      if (typeof out === "object") {
        outgoing[pos] = {pieces:[{raw: item.data}]};
        console.log("ERROR", out);
      }
      if (parsers[(pos%2)].nextCb) {
        process.nextTick(parsers[(pos%2)].nextCb);
      }
    }
  }, function (err) {
    req.query.needgzip = "false";
    parsers[0].finish();
    parsers[1].finish();
    setTimeout(function() {localSessionDetailReturnFull(req, res, session, outgoing);}, 100);
  });
}

function imageDecodeHTTP(req, res, session, incoming, findBody) {
  var kind;

  if (incoming[0].data.slice(0,4).toString() === "HTTP") {
    kind = [HTTPParser.RESPONSE, HTTPParser.REQUEST];
  } else {
    kind = [HTTPParser.REQUEST, HTTPParser.RESPONSE];
  }
  var parsers = [new HTTPParser(kind[0]), new HTTPParser(kind[1])];

  var bodyNum = 0;
  var bodyType = "file";
  parsers[0].onBody = parsers[1].onBody = function(buf, start, len) {
    if (findBody === bodyNum) {
      return res.end(buf.slice(start));
    }

    var pos = this.pos;

    if (this.image) {
      outgoing[pos] = {pieces: [{bodyNum: bodyNum, bodyType:"image", bodyName:"image" + bodyNum}]};
    } else {
      outgoing[pos] = {pieces: [{bodyNum: bodyNum, bodyType:"file", bodyName:"file" + bodyNum}]};
    }
    // Copy over the headers
    if (outgoing[pos] === undefined) {
      outgoing[pos].pieces[0].raw = buf.slice(0, start);
    } else if (outgoing[pos].data === undefined) {
      outgoing[pos].pieces[0].raw = "";
    }
    bodyNum++;
  };

  parsers[0].onMessageComplete = parsers[1].onMessageComplete = function() {
    if (this.pos > 0 && this.hinfo && this.hinfo.statusCode !== 100) {
      parsers[(this.pos+1)%2].reinitialize(kind[(this.pos+1)%2]);
    }
    var pos = this.pos;

    if (!outgoing[pos]) {
      outgoing[pos] = {pieces: [{raw: incoming[pos].data}]};
    }
  };

  parsers[0].onHeadersComplete = parsers[1].onHeadersComplete = function(info) {
    var pos = this.pos;
    this.hinfo = info;

    var h;
    this.image = false;
    for (h = 0; h < info.headers.length; h += 2) {
      if (info.headers[h].match(/Content-Type/i)) {
        if (info.headers[h+1].match(/^image/i)) {
          this.image = true;
        }
        break;
      }
    }
  };

  var outgoing = [];

  var p = 0;
  async.forEachSeries(incoming, function(item, nextCb) {
    parsers[(p%2)].pos = p;

    if (!item) {
    } else if (item.data.length === 0) {
      outgoing[p] = {pieces:[{raw: item.data}]};
    } else {
      var out = parsers[(p%2)].execute(item.data, 0, item.data.length);
      if (typeof out === "object") {
        outgoing[p] = {pieces:[{raw: item.data}]};
        console.log("ERROR", out);
      }

      if (!outgoing[p]) {
        outgoing[p] = {pieces: [{raw: incoming[p].data}]};
      }
    }

    if (res.finished === true) {
      return nextCb("Done!");
    } else {
      process.nextTick(nextCb);
    }
    p++;
  }, function (err) {
    if (findBody === -1) {
      process.nextTick(function() {localSessionDetailReturnFull(req, res, session, outgoing);});
    }
  });
}

function imageDecodeSMTP(req, res, session, incoming, findBody) {
  var outgoing = [];

  var STATES = {
    cmd: 1,
    header: 2,
    data: 3,
    mime: 4,
    mime_data: 5,
    ignore: 6
  };

  var states = [STATES.cmd, STATES.cmd];
  var bodyNum = 0;
  var bodyType = "file";
  var bodyName = "unknown";

  function parse(data, p) {
    var lines = data.toString("binary").replace(/\r?\n$/, '').split(/\r?\n|\r/);
    var state = states[p%2];
    var header = "";
    var mime;
    var boundaries = [];
    var pieces = [{raw: ""}];
    var b;
    var matches;

    linesloop:
    for (var l = 0; l < lines.length; l++) {
      switch (state) {
      case STATES.cmd:
        pieces[pieces.length-1].raw += lines[l] + "\n";

        if (lines[l].toUpperCase() === "DATA") {
          state = STATES.header;
          header = "";
          boundaries = [];
        } else if (lines[l].toUpperCase() === "STARTTLS") {
          state = STATES.ignore;
        }
        break;
      case STATES.header:
        pieces[pieces.length-1].raw += lines[l] + "\n";
        if (lines[l][0] === " " || lines[l][0] === "\t") {
          header += lines[l];
          continue;
        }
        if (header.substr(0, 13).toLowerCase() === "content-type:") {
          if ((matches = header.match(/boundary\s*=\s*("?)([^"]*)\1/))) {
            boundaries.push(matches[2]);
          }
        }
        if (lines[l] === "") {
          state = STATES.data;
          continue;
        }
        header = lines[l];
        break;
      case STATES.data:
        pieces[pieces.length-1].raw += lines[l] + "\n";
        if (lines[l] === ".") {
          state = STATES.cmd;
          continue;
        }

        if (lines[l][0] === '-') {
          for (b = 0; b < boundaries.length; b++) {
            if (lines[l].substr(2, boundaries[b].length) === boundaries[b]) {
              state = STATES.mime;
              mime = {line:"", base64:0};
              continue linesloop;
            }
          }
        }
        break;
      case STATES.mime:
        if (lines[l] === ".") {
          state = STATES.cmd;
          continue;
        }

        pieces[pieces.length-1].raw += lines[l] + "\n";

        if (lines[l][0] === " " || lines[l][0] === "\t") {
          mime.line += lines[l];
          continue;
        }
        if (mime.line.substr(0, 13).toLowerCase() === "content-type:") {
          if ((matches = mime.line.match(/boundary\s*=\s*("?)([^"]*)\1/))) {
            boundaries.push(matches[2]);
          }
          if ((matches = mime.line.match(/name\s*=\s*("?)([^"]*)\1/))) {
            bodyName = matches[2];
          }

          if (mime.line.match(/content-type: image/i)) {
            bodyType = "image";
          }

        } else if (mime.line.match(/content-disposition:/i)) {
          if ((matches = mime.line.match(/filename\s*=\s*("?)([^"]*)\1/))) {
            bodyName = matches[2];
          }
        } else if (mime.line.match(/content-transfer-encoding:.*base64/i)) {
          mime.base64 = 1;
          mime.doit = 1;
        }
        if (lines[l] === "") {
          if (mime.doit) {
            pieces[pieces.length-1].bodyNum = bodyNum+1;
            pieces[pieces.length-1].bodyType = bodyType;
            pieces[pieces.length-1].bodyName = bodyName;
            pieces.push({raw: ""});
            bodyType = "file";
            bodyName = "unknown";
            bodyNum++;
          }
          state = STATES.mimedata;
          continue;
        }
        mime.line = lines[l];
        break;
      case STATES.mimedata:
        if (lines[l] === ".") {
          if (findBody !== -1) {
            return res.end();
          }
          state = STATES.cmd;
          continue;
        }

        if (lines[l][0] === '-') {
          for (b = 0; b < boundaries.length; b++) {
            if (lines[l].substr(2, boundaries[b].length) === boundaries[b]) {
              if (findBody === bodyNum) {
                return res.end();
              }
              state = STATES.mime;
              mime = {line:"", base64:0};
              continue linesloop;
            }
          }
        }

        if (!mime.doit) {
          pieces[pieces.length-1].raw += lines[l] + "\n";
        } else if (findBody === bodyNum) {
          res.write(new Buffer(lines[l], 'base64'));
        }
        break;
      }
    }
    states[p%2] = state;

    return pieces;
  }

  var p = 0;
  for (var p = 0; p < incoming.length; p++) {
    if (incoming[p].data.length === 0) {
      outgoing[p] = {pieces:[{raw: incoming[p].data}]};
    } else {
      outgoing[p] = {pieces: parse(incoming[p].data, p)};
    }
    if (res.finished === true) {
      break;
    }
  }

  if (findBody === -1) {
    process.nextTick(function() {localSessionDetailReturnFull(req, res, session, outgoing);});
  }
}

function imageDecode(req, res, session, results, findBody) {
  if (results[0].data.slice(0,4).toString() === "HTTP" || (results[1] && results[1].data.slice(0,4).toString() === "HTTP")) {
    return imageDecodeHTTP(req, res, session, results, findBody);
  }

  if (results[0].data.slice(0,4).toString().match(/(HELO|EHLO)/) ||
      (results[1] && results[1].data.slice(0,4).toString().match(/(HELO|EHLO)/)) ||
      (results[2] && results[2].data.slice(0,4).toString().match(/(HELO|EHLO)/))) {
    return imageDecodeSMTP(req, res, session, results, findBody);
  }

  req.query.needimage = "false";
  if (findBody === -1) {
    process.nextTick(function() {localSessionDetailReturn(req, res, session, results);});
  }
}

function localSessionDetailReturn(req, res, session, incoming) {
  if (incoming.length > 200) {
    incoming.length = 200;
  }

  if (req.query.needgzip === "true") {
    return gzipDecode(req, res, session, incoming);
  }

  if (req.query.needimage === "true") {
    return imageDecode(req, res, session, incoming, -1);
  }

  var outgoing = [];
  for (var r = 0; r < incoming.length; r++) {
    outgoing.push({pieces: [{raw: incoming[r].data}]});
  }
  localSessionDetailReturnFull(req, res, session, outgoing);
}


function localSessionDetail(req, res) {
  if (!req.query) {
    req.query = {gzip: false, line: false, base: "natural"};
  }

  req.query.needgzip  = req.query.gzip  || false;
  req.query.needimage = req.query.image || false;
  req.query.line  = req.query.line  || false;
  req.query.base  = req.query.base  || "ascii";

  var packets = [];
  processSessionId(req.params.id, null, function (buffer, cb) {
    var obj = {};
    if (buffer.length > 16) {
      decode.pcap(buffer, obj);
    } else {
      obj = {ip: {p: "Empty"}};
    }
    packets.push(obj);
    cb(null);
  },
  function(err, session) {
    if (err) {
      res.send("Error");
      return;
    }
    session.id = req.params.id;
    session.ta = session.ta.sort();
    if (session.hh) {
      session.hh = session.hh.sort();
    }
    if (session.hh1) {
      session.hh1 = session.hh1.sort();
    }
    if (session.hh2) {
      session.hh2 = session.hh2.sort();
    }
    //console.log("session", util.inspect(session, false, 15));
    /* Now reassembly the packets */
    if (packets.length === 0) {
      localSessionDetailReturn(req, res, session, [{data: "No pcap data found"}]);
    } else if (packets[0].ip.p === 1) {
      decode.reassemble_icmp(packets, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else if (packets[0].ip.p === 6) {
      decode.reassemble_tcp(packets, decode.inet_ntoa(session.a1) + ':' + session.p1, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else if (packets[0].ip.p === 17) {
      decode.reassemble_udp(packets, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else {
      localSessionDetailReturn(req, res, session, [{data: "Unknown ip.p=" + packets[0].ip.p}]);
    }
  },
  req.query.needimage === "true"?10000:400);
}

function localBody(req, res) {
  var packets = [];
  if (req.params.bodyType === "file") {
    res.setHeader("Content-Type", "application/force-download");
  }
  processSessionId(req.params.id, null, function (buffer, cb) {
    var obj = {};
    if (buffer.length > 16) {
      decode.pcap(buffer, obj);
    } else {
      obj = {ip: {p: "Empty"}};
    }
    packets.push(obj);
    cb(null);
  },
  function(err, session) {
    if (err) {
      res.send("Error");
      return;
    }
    decode.reassemble_tcp(packets, decode.inet_ntoa(session.a1) + ':' + session.p1, function(err, results) {
      return imageDecode(req, res, session, results, +req.params.bodyNum);
    });
  },
  10000);
}

function getViewUrl(node, cb) {
  var url = Config.getFull(node, "viewUrl");
  if (url) {
    cb(null, url);
    return;
  }

  Db.molochNodeStatsCache(node, function(err, stat) {
    if (Config.isHTTPS(node)) {
      cb(null, "https://" + stat.hostname + ":" + Config.getFull(node, "viewPort", "8005"), httpsAgent);
    } else {
      cb(null, "http://" + stat.hostname + ":" + Config.getFull(node, "viewPort", "8005"), httpAgent);
    }
  });
}

function addAuth(info, user, node) {
    if (!info.headers) {
        info.headers = {};
    }
    info.headers['x-moloch-auth'] = Config.obj2auth({date: Date.now(),
                                                     user: user.userId,
                                                     node: node,
                                                     path: info.path
                                                    });
}

function proxyRequest (req, res) {
  noCache(req, res);

  getViewUrl(req.params.nodeName, function(err, viewUrl, agent) {
    if (err) {
      console.log(err);
      res.send("Check logs on " + os.hostname());
    }
    var info = url.parse(viewUrl);
    info.path = req.url;
    info.rejectUnauthorized = true;
    addAuth(info, req.user, req.params.nodeName);

    var preq = agent.request(info, function(pres) {
      pres.on('data', function (chunk) {
        res.write(chunk);
      });
      pres.on('end', function () {
        res.end();
      });
    });

    preq.on('error', function (e) {
      console.log("error = ", e);
      res.send("Unknown error, check logs on " + os.hostname());
    });
    preq.end();
  });
}

app.get('/:nodeName/:id/sessionDetail', function(req, res) {
  noCache(req, res);

  isLocalView(req.params.nodeName, function () {
    localSessionDetail(req, res);
  },
  function () {
    proxyRequest(req, res);
  });
});


app.get('/:nodeName/:id/body/:bodyType/:bodyNum/:bodyName', function(req, res) {
  isLocalView(req.params.nodeName, function () {
    localBody(req, res);
  },
  function () {
    proxyRequest(req, res);
  });
});

function writePcap(res, id, writeHeader, doneCb) {
  var b = new Buffer(100000);
  var boffset = 0;

  processSessionId(id, function (buffer) {
    if (writeHeader) {
      res.write(buffer);
      writeHeader = 0;
    }
  },
  function (buffer, cb) {
    if (boffset + buffer.length > b.length) {
      res.write(b.slice(0, boffset));
      boffset = 0;
    }
    buffer.copy(b, boffset, 0, buffer.length);
    boffset += buffer.length;
    cb(null);
  },
  function(err, session) {
    if (err) {
      console.log("writePcap", err);
    }
    res.write(b.slice(0, boffset));
    doneCb(err, writeHeader);
  });
}

app.get('/:nodeName/pcap/:id.pcap', function(req, res) {
  noCache(req, res);

  res.setHeader("Content-Type", "application/vnd.tcpdump.pcap");
  res.statusCode = 200;

  isLocalView(req.params.nodeName, function () {
    writePcap(res, req.params.id, !req.query || !req.query.noHeader || req.query.noHeader !== "true", function () {
      res.end();
    });
  },
  function() {
    proxyRequest(req, res);
  });
});

function writeRawReturn(res, type, results, doneCb) {
  for (var i = 0; i < results.length; i++) {
    if ((i % 2 === 0 && type === 'src') ||
        (i % 2 === 1 && type === 'dst')) {
      res.write(results[i].data);
    }
  }
  res.end();
}


function writeRaw(res, id, type, doneCb) {
  var packets = [];
  processSessionId(id, null, function (buffer, cb) {
    var obj = {};
    if (buffer.length > 16) {
      decode.pcap(buffer, obj);
    } else {
      obj = {ip: {p: ""}};
    }
    packets.push(obj);
    cb(null);
  },
  function(err, session) {
    if (err) {
      res.send("Error");
      return;
    }
    if (packets.length === 0) {
      res.end();
    } else if (packets[0].ip.p === 1) {
      decode.reassemble_icmp(packets, function(err, results) {
        writeRawReturn(res, type, results, doneCb);
      });
    } else if (packets[0].ip.p === 6) {
      decode.reassemble_tcp(packets, decode.inet_ntoa(session.a1) + ':' + session.p1, function(err, results) {
        writeRawReturn(res, type, results, doneCb);
      });
    } else if (packets[0].ip.p === 17) {
      decode.reassemble_udp(packets, function(err, results) {
        writeRawReturn(res, type, results, doneCb);
      });
    } else {
      res.end();
    }
  },
  10000);
}

app.get('/:nodeName/raw/:id', function(req, res) {
  noCache(req, res);

  res.setHeader("Content-Type", "application/vnd.tcpdump.pcap");
  res.statusCode = 200;

  isLocalView(req.params.nodeName, function () {
    writeRaw(res, req.params.id, req.query.type||"src", function () {
      res.end();
    });
  },
  function() {
    proxyRequest(req, res);
  });
});

app.get('/:nodeName/entirePcap/:id.pcap', function(req, res) {
  noCache(req, res);

  isLocalView(req.params.nodeName, function () {
    var query = { fields: ["ro"],
                  size: 1000,
                  query: {term: {ro: req.params.id}},
                  sort: { lp: { order: 'asc' } }
                };

    console.log(JSON.stringify(query));

    res.setHeader("Content-Type", "application/vnd.tcpdump.pcap");
    res.statusCode = 200;

    Db.searchPrimary('sessions*', 'session', query, function(err, data) {
      var firstHeader = 1;

      async.forEachSeries(data.hits.hits, function(item, nextCb) {
        writePcap(res, item._id, firstHeader, function (err, stillNeedWriteHeader) {
          firstHeader = stillNeedWriteHeader;
          nextCb(err);
        });
      }, function (err) {
        res.end();
      });
    });
  },
  function() {
    proxyRequest(req, res);
  });
});

app.get('/sessions.pcap', function(req, res) {
  noCache(req, res);

  res.setHeader("Content-Type", "application/vnd.tcpdump.pcap");
  res.statusCode = 200;

  buildSessionQuery(req, function(err, query, indices) {
    query.fields = ["no"];
    Db.searchPrimary(indices, 'session', query, function(err, result) {
      var firstHeader = 1;

      async.forEachSeries(result.hits.hits, function(item, nextCb) {
        isLocalView(item.fields.no, function () {
          // Get from our DISK
          writePcap(res, item._id, firstHeader, function (err, stillNeedWriteHeader) {
            firstHeader = stillNeedWriteHeader;
            nextCb(err);
          });
        },
        function () {
          // Get from remote DISK
          getViewUrl(item.fields.no, function(err, viewUrl, agent) {
            var info = url.parse(viewUrl);

            if (firstHeader) {
              info.path = Config.basePath(item.fields.no) + item.fields.no + "/pcap/" + item._id + ".pcap";
            } else {
              info.path = Config.basePath(item.fields.no) + item.fields.no + "/pcap/" + item._id + ".pcap?noHeader=true";
            }

            addAuth(info, req.user, item.fields.no);
            var preq = agent.request(info, function(pres) {
              pres.on('data', function (chunk) {
                firstHeader = 0; // Don't reset until we actually get data
                res.write(chunk);
              });
              pres.on('end', function () {
                nextCb(null);
              });
            });
            preq.on('error', function (e) {
              console.log("error = ", e);
              nextCb(null);
            });
            preq.end();
          });
        });
      }, function(err) {
        res.end();
      });
    });
  });
});

app.post('/deleteUser/:userId', function(req, res) {
  if (!req.user.createEnabled) {
    return res.send(JSON.stringify({success: false, text: "Need admin privileges"}));
  }

  if (!req.body.token) {
    return res.send(JSON.stringify({success: false, text: "Missing token"}));
  }

  var token = Config.auth2obj(req.body.token);
  if (Math.abs(Date.now() - token.date) > 600000 || token.pid !== process.pid || token.userId !== req.user.userId) {
    console.log("bad token", token);
    return res.send(JSON.stringify({success: false, text: "Timeout - Please try reloading page and repeating the action"}));
  }

  if (req.params.userId === req.user.userId) {
    return res.send(JSON.stringify({success: false, text: "Can not delete yourself"}));
  }

  Db.deleteDocument('users', 'user', req.params.userId, function(err, data) {
    return res.send(JSON.stringify({success: true, text: "User deleted"}));
  });
});

app.post('/addUser', function(req, res) {
  if (!req.user.createEnabled) {
    return res.send(JSON.stringify({success: false, text: "Need admin privileges"}));
  }

  if (!req.body.token) {
    return res.send(JSON.stringify({success: false, text: "Missing token"}));
  }

  var token = Config.auth2obj(req.body.token);
  if (Math.abs(Date.now() - token.date) > 600000 || token.pid !== process.pid || token.userId !== req.user.userId) {
    console.log("bad token", token);
    return res.send(JSON.stringify({success: false, text: "Timeout - Please try reloading page and repeating the action"}));
  }

  if (!req.body || !req.body.userId || !req.body.userName || !req.body.password) {
    return res.send(JSON.stringify({success: false, text: "Missing/Empty required fields"}));
  }

  Db.get("users", 'user', req.body.userId, function(err, user) {
    if (err || user.exists) {
      return res.send(JSON.stringify({success: false, text: "User already exists"}));
    }

    var nuser = {
      userId: req.body.userId,
      userName: req.body.userName,
      expression: req.body.expression,
      passStore: Config.pass2store(req.body.userId, req.body.password),
      enabled: req.body.enabled  === "on",
      webEnabled: req.body.webEnabled  === "on",
      emailSearch: req.body.emailSearch  === "on",
      headerAuthEnabled: req.body.headerAuthEnabled === "on",
      createEnabled: req.body.createEnabled === "on"
    };

    console.log("Creating new user", nuser);
    Db.indexNow("users", "user", req.body.userId, nuser, function(err, info) {
      console.log("add user", err, info);
      if (!err) {
        return res.send(JSON.stringify({success: true}));
      } else {
        return res.send(JSON.stringify({success: false, text: err}));
      }
    });
  });


});

app.post('/updateUser/:userId', function(req, res) {
  if (!req.user.createEnabled) {
    return res.send(JSON.stringify({success: false, text: "Need admin privileges"}));
  }

  if (!req.body.token) {
    return res.send(JSON.stringify({success: false, text: "Missing token"}));
  }

  var token = Config.auth2obj(req.body.token);
  if (Math.abs(Date.now() - token.date) > 600000 || token.pid !== process.pid || token.userId !== req.user.userId) {
    console.log("bad token", token);
    return res.send(JSON.stringify({success: false, text: "Timeout - Please try reloading page and repeating the action"}));
  }

  Db.get("users", 'user', req.params.userId, function(err, user) {
    if (err || !user.exists) {
      return res.send(JSON.stringify({success: false, text: "User not found"}));
    }
    user = user._source;

    if (req.query.enabled) {
      user.enabled = req.query.enabled === "true";
    }

    if (req.query.webEnabled) {
      user.webEnabled = req.query.webEnabled === "true";
    }

    if (req.query.emailSearch) {
      user.emailSearch = req.query.emailSearch === "true";
    }

    if (req.query.headerAuthEnabled) {
      user.headerAuthEnabled = req.query.headerAuthEnabled === "true";
    }

    if (req.user.createEnabled && req.query.createEnabled) {
      user.createEnabled = req.query.createEnabled === "true";
    }

    Db.indexNow("users", "user", req.params.userId, user, function(err, info) {
      return res.send(JSON.stringify({success: true}));
    });
  });
});

app.post('/changePassword', function(req, res) {

  if (!req.body.newPassword || req.body.newPassword.length < 3) {
    return res.send(JSON.stringify({success: false, text: "New password needs to be at least 2 characters"}));
  }

  if (!req.body.token) {
    return res.send(JSON.stringify({success: false, text: "Missing token"}));
  }

  var token = Config.auth2obj(req.body.token);
  if (Math.abs(Date.now() - token.date) > 120000 || token.pid !== process.pid) { // Request has to be +- 120 seconds and same pid
    console.log("bad token", token);
    return res.send(JSON.stringify({success: false, text: "Try reloading page"}));
  }

  if (token.cp && (req.user.passStore !== Config.pass2store(req.user.userId, req.body.currentPassword) ||
                   token.userId !== req.user.userId)) {
    return res.send(JSON.stringify({success: false, text: "Current password mismatch"}));
  }

  Db.get("users", 'user', token.userId, function(err, user) {
    user = user._source;
    if (err) {
      return res.send(JSON.stringify({success: false, text: err}));
    }
    user.passStore = Config.pass2store(user.userId, req.body.newPassword);
    Db.indexNow("users", "user", user.userId, user, function(err, info) {
      if (err) {
        return res.send(JSON.stringify({success: false, text: err}));
      }
      return res.send(JSON.stringify({success: true, text: "Changed password successfully"}));
    });
  });
});
//////////////////////////////////////////////////////////////////////////////////
//// Main
//////////////////////////////////////////////////////////////////////////////////
dbCheck();
expireCheckAll();
setInterval(expireCheckAll, 5*60*1000);
app.listen(Config.get("viewPort", "8005"));
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);

