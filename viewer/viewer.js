/******************************************************************************/
/* viewer.js  -- The main moloch app
 *
 * Copyright 2012-2013 AOL Inc. All rights reserved.
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

var MIN_DB_VERSION = 10;

//// Modules
//////////////////////////////////////////////////////////////////////////////////
try {
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
    Pcap           = require('./pcap.js'),
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
} catch (e) {
  console.log ("ERROR - Couldn't load some dependancies, maybe need to 'npm install' inside viewer directory", e);
  process.exit(1);
}

try {
  var Png = require('png').Png;
} catch (e) {console.log("WARNING - No png support, maybe need to 'npm install'", e);}

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
                           elasticBase: "http://" + (escInfo[0] === "localhost"?os.hostname():escInfo[0]) + ":" + escInfo[1],
                           spiData: false,
                           fieldsMap: JSON.stringify(Config.getFieldsMap())
                          });

  app.use(express.favicon(__dirname + '/public/favicon.ico'));
  app.use(passport.initialize());
  app.use(function(req, res, next) {
    req.url = req.url.replace(Config.basePath(), "/");
    return next();
  });
  app.use(express.bodyParser());
  app.use(connectTimeout({ time: 30*60*1000 }));
  app.use(express.logger({ format: ':date :username \x1b[1m:method\x1b[0m \x1b[33m:url\x1b[0m :res[content-length] bytes :response-time ms' }));
  app.use(express.compress());
  app.use(express.methodOverride());
  app.use("/", express['static'](__dirname + '/public', { maxAge: 60 * 1000}));
  if (Config.get("passwordSecret")) {
    app.use(function(req, res, next) {
      // 200 for NS
      if (req.url === "/_ns_/nstest.html") {
        return res.end();
      }

      // No auth for stats.json, dstats.json, esstats.json
      if (req.url.match(/^\/[e]*[ds]*stats.json/)) {
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

  express.logger.token('username', function(req, res){ return req.user?req.user.userId:"-"; });
});


//////////////////////////////////////////////////////////////////////////////////
//// Utility
//////////////////////////////////////////////////////////////////////////////////
function isEmptyObject(object) { for(var i in object) { return false; } return true; }
function safeStr(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/\'/g, '&#39;');
}

//http://garethrees.org/2007/11/14/pngcrush/
var emptyPNG = new Buffer("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", 'base64');
var PNG_LINE_WIDTH = 256;

//////////////////////////////////////////////////////////////////////////////////
//// DB
//////////////////////////////////////////////////////////////////////////////////
Db.initialize({host : escInfo[0], port: escInfo[1]});
Db.esVersion(function (ver) {
  // SPI View requires 0.90.0 or later
  if (ver >= (90 << 8)) {
    var vo = app.set("view options");
    vo.spiData = true;
    app.set("view options", vo);
  } else {
    console.log("SPI View display requires Elasticsearch 0.90 RC1 or newer");
  }
});

function deleteFile(node, id, path, cb) {
  fs.unlink(path, function() {
    Db.deleteDocument('files', 'file', id, function(err, data) {
      cb(null);
    });
  });
}

function isLocalView(node, yesCB, noCB) {
  if (node === Config.nodeName()) {
    return yesCB();
  }

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
    titleLink: 'sessionsLink',
    isIndex: true
  });
});

app.get("/spiview", function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  if (!app.set("view options").spiData) {
    return res.send("Elastic Search 0.90.0 RC1 requried");
  }

  res.render('spiview', {
    user: req.user,
    title: 'SPI View',
    titleLink: 'spiLink',
    isIndex: true,
    reqFields: Config.headers("headers-http-request"),
    resFields: Config.headers("headers-http-response"),
    emailFields: Config.headers("headers-email")
  });
});

app.get("/spigraph", function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  var fields = Config.getFields();
  fields = fields.sort(function(a,b) {return (a.exp > b.exp?1:-1);});
  res.render('spigraph', {
    user: req.user,
    title: 'SPI Graph',
    titleLink: 'spigraphLink',
    isIndex: true,
    fields: fields
  });
});

app.get("/connections", function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('connections', {
    user: req.user,
    title: 'Connections',
    titleLink: 'connectionsLink',
    isIndex: true
  });
});

app.get('/about', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  var fields = Config.getFields();
  fields = fields.sort(function(a,b) {return (a.exp > b.exp?1:-1);});
  res.render('about', {
    user: req.user,
    title: 'About',
    titleLink: 'aboutLink',
    fields: fields
  });
});

app.get('/files', function(req, res) {
  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('files', {
    user: req.user,
    title: 'Files',
    titleLink: 'filesLink'
  });
});

app.get('/users', function(req, res) {
  if (!req.user.webEnabled || !req.user.createEnabled) {
    return res.send("Moloch Permision Denied");
  }
  res.render('users', {
    user: req.user,
    title: 'Users',
    titleLink: 'usersLink',
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
      title: 'Change Password',
      titleLink: 'changePasswordLink'
    });
  }

  if (!req.user.webEnabled) {
    return res.send("Moloch Permision Denied");
  }

  if (Config.get("disableChangePassword", false)) {
    return res.send("Disabled");
  }

  if (req.query.userId) {
    Db.get("users", 'user', req.query.userId, function(err, user) {
      if (err || !user.exists) {
        console.log("ERROR - /password error", err, user);
        return res.send("Unknown user");
      }
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
      titleLink: 'statsLink',
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

fs.unlink("./public/style.css", function () {}); // Remove old style.css file
app.get('/style.css', function(req, res) {
  fs.readFile("./views/style.styl", 'utf8', function(err, str) {
    if (err) {return console.log("ERROR - ", err);}
    var style = stylus(str, "./views");
    style.render(function(err, css){
      if (err) {return console.log("ERROR - ", err);}
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
}

function noCache(req, res) {
  res.header('Cache-Control', 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0');
}

app.get('/esstats.json', function(req, res) {
  var stats = [];

  async.parallel({
    nodes: function(nodesCb) {
      Db.nodesStats({"jvm": 1}, nodesCb);
    },
    health: function (healthCb) {
      Db.healthCache(healthCb);
    }
  },
  function(err, results) {
    var nodes = Object.keys(results.nodes.nodes);
    for (var n = 0; n < nodes.length; n++) {
      var node = results.nodes.nodes[nodes[n]];
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
             health: results.health,
             iTotalRecords: stats.length,
             iTotalDisplayRecords: stats.length,
             aaData: stats};
    res.send(r);
  });
});

app.get('/stats.json', function(req, res) {
  noCache(req, res);

  var columns = ["", "_id", "currentTime", "totalPackets", "totalK", "totalSessions", "monitoring", "memory", "freeSpaceM", "deltaPackets", "deltaBytes", "deltaSessions", "deltaDropped", "deltaMS"];
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

  async.parallel({
    stats: function (cb) {
      Db.search('stats', 'stat', query, function(err, result) {
        var i;
        if (err || result.error) {
          res.send({total: 0, results: []});
        } else {
          var results = {total: result.hits.total, results: []};
          for (i = 0; i < result.hits.hits.length; i++) {
            result.hits.hits[i].fields.id     = result.hits.hits[i]._id;
            result.hits.hits[i].fields.memory = result.hits.hits[i].fields.memory || 0;
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

app.get('/:nodeName/:fileNum/filesize.json', function(req, res) {
  Db.fileIdToFile(req.params.nodeName, req.params.fileNum, function(file) {
    if (!file) {
      return res.send({filesize: -1});
    }

    fs.stat(file.name, function (err, stats) {
      if (err || !stats) {
        return res.send({filesize: -1});
      } else {
        return res.send({filesize: stats.size});
      }
    });
  });
});

app.get('/files.json', function(req, res) {
  noCache(req, res);

  var columns = ["num", "node", "name", "locked", "first", "filesize"];
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
          if (item.filesize && item.filesize !== 0) {
            return cb(null);
          }

          isLocalView(item.node, function () {
            fs.stat(item.name, function (err, stats) {
              if (err || !stats) {
                item.filesize = -1;
              } else {
                item.filesize = stats.size;
                if (item.locked) {
                  Db.updateFileSize(item, stats.size);
                }
              }
              cb(null);
            });
          }, function () {
            item.filesize = -2;
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
            result.hits.hits[i].fields.expression = safeStr(result.hits.hits[i].fields.expression || "");
            result.hits.hits[i].fields.headerAuthEnabled = result.hits.hits[i].fields.headerAuthEnabled || false;
            result.hits.hits[i].fields.emailSearch = result.hits.hits[i].fields.emailSearch || false;
            result.hits.hits[i].fields.userName = safeStr(result.hits.hits[i].fields.userName || "");
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
function lookupQueryItems(query, doneCb) {
  var outstanding = 0;
  var finished = 0;
  var err = null;

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
            doneCb(err);
          }
        });
      } else {
        outstanding++;
        var tag = (item !== "ta"?"http:header:" + obj[item].toLowerCase():obj[item]);

        Db.tagNameToId(tag, function (id) {
          outstanding--;
          if (id === null) {
            err = "Tag '" + tag + "' not found";
          } else {
            obj[item] = id;
          }
          if (finished && outstanding === 0) {
            doneCb(err);
          }
        });
      }
    } else if (item === "fileand" && typeof obj[item] === "string") {
      var name = obj.fileand;
      delete obj.fileand;
      outstanding++;
      Db.fileNameToFile(name, function (file) {
        outstanding--;
        if (file === null) {
          err = "File '" + name + "' not found";
        } else {
          obj.and = [{term: {no: file.node}}, {term: {fs: file.num}}];
        }
        if (finished && outstanding === 0) {
          doneCb(err);
        }
      });
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
    return doneCb(err);
  }

  finished = 1;
}

function buildSessionQuery(req, buildCb) {
  var columns = ["pr", "ro", "db", "fp", "lp", "a1", "p1", "a2", "p2", "pa", "by", "no", "us", "g1", "g2", "esub", "esrc", "edst", "efn", "dnsho", "tls"];
  var limit = (req.query.iDisplayLength?Math.min(parseInt(req.query.iDisplayLength, 10),100000):100);
  var i;


  var query = {fields: columns,
               from: req.query.iDisplayStart || 0,
               size: limit,
               query: {filtered: {query: {}}}
              };

  var interval;
  if (req.query.date && req.query.date === '-1') {
    interval = 60*60; // Hour to be safe
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
    var diff = req.query.stopTime - req.query.startTime;
    if (diff < 30*60) {
      interval = 1; // second
    } else if (diff <= 5*24*60*60) {
      interval = 60; // minute
    } else {
      interval = 60*60; // hour
    }
  } else {
    if (!req.query.date) {
      req.query.date = 1;
    }
    req.query.startTime = (Math.floor(Date.now() / 1000) - 60*60*parseInt(req.query.date, 10));
    req.query.stopTime = Date.now()/1000;
    query.query.filtered.query.range = {lp: {from: req.query.startTime}};
    if (req.query.date <= 5*24) {
      interval = 60; // minute
    } else {
      interval = 60*60; // hour
    }
  }

  if (req.query.facets) {
    query.facets = {
                     dbHisto: {histogram : {key_field: "lp", value_field: "db", interval: interval, size:1440}},
                     paHisto: {histogram : {key_field: "lp", value_field: "pa", interval: interval, size:1440}},
                     map1: {terms : {field: "g1", size:1000}},
                     map2: {terms : {field: "g2", size:1000}}
                   };
  }

  addSortToQuery(query, req.query, "fp");

  var err = null;
  molochparser.parser.yy = {emailSearch: req.user.emailSearch === true, fieldsMap: Config.getFieldsMap()};
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

  lookupQueryItems(query.query.filtered, function (lerr) {
    if (req.query.date && req.query.date === '-1') {
      return buildCb(err || lerr, query, "sessions*");
    }

    getIndices(req.query.startTime, req.query.stopTime, function(indices) {
      return buildCb(err || lerr, query, indices);
    });
  });
}

function mapMerge(facets) {
  var map = {};

  facets.map1.terms.forEach(function (item) {
    if (item.count < 0) {
      item.count = 0x7fffffff;
    }
    map[item.term] = item.count;
  });

  facets.map2.terms.forEach(function (item) {
    if (item.count < 0) {
      item.count = 0x7fffffff;
    }
    if (!map[item.term]) {
      map[item.term] = 0;
    }
    map[item.term] += item.count;
  });
  return map;
}

function histoMerge(req, query, facets, graph) {
  graph.lpHisto = [];
  graph.dbHisto = [];
  graph.paHisto = [];
  graph.xmin = req.query.startTime  * 1000|| null;
  graph.xmax = req.query.stopTime * 1000 || null;
  graph.interval = query.facets.dbHisto.histogram.interval || 60;

  facets.paHisto.entries.forEach(function (item) {
    graph.lpHisto.push([item.key*1000, item.count]);
    graph.paHisto.push([item.key*1000, item.total]);
  });

  facets.dbHisto.entries.forEach(function (item) {
    graph.dbHisto.push([item.key*1000, item.total]);
  });

}

app.get('/sessions.json', function(req, res) {
  var i;

  var graph = {
        interval: 60,
        lpHisto: [],
        dbHisto: [],
        paHisto: []
      };
  var map = {};
  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {sEcho: req.query.sEcho,
               iTotalRecords: 0,
               iTotalDisplayRecords: 0,
               graph: graph,
               map: map,
               bsqErr: bsqErr.toString(),
               aaData:[]};
      res.send(r);
      return;
    }
    if (query.facets && query.facets.dbHisto) {
      graph.interval = query.facets.dbHisto.histogram.interval;
    }

    console.log("sessions.json query", JSON.stringify(query));

    async.parallel({
      sessions: function (sessionsCb) {
        Db.searchPrimary(indices, 'session', query, function(err, result) {
          //console.log("sessions query = ", util.inspect(result, false, 50));
          if (err || result.error) {
            console.log("sessions.json error", err, (result?result.error:null));
            sessionsCb(null, {total: 0, results: []});
            return;
          }

          if (!result.facets) {
            result.facets = {map1: {terms: []}, map2: {terms: []}, dbHisto: {entries: []}, paHisto: {entries: []}};
          }

          histoMerge(req, query, result.facets, graph);
          map = mapMerge(result.facets);

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
      var r = {sEcho: req.query.sEcho,
               iTotalRecords: results.total,
               iTotalDisplayRecords: (results.sessions?results.sessions.total:0),
               graph: graph,
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

app.get('/spigraph.json', function(req, res) {
  req.query.facets = 1;
  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {sEcho: req.query.sEcho,
               iTotalRecords: 0,
               iTotalDisplayRecords: 0,
               graph: {},
               map: {},
               bsqErr: bsqErr.toString(),
               items:[]};
      res.send(r);
      return;
    }

    delete query.fields;
    delete query.sort;
    query.size = 0;
    var size = +req.query.size || 20;

    var field = req.query.field || "no";
    query.facets.field = {terms: {field: field, size: size}};

    /* Need the nextTick so we don't blow max stack frames */
    var eachCb = function (item, cb) {process.nextTick(cb);};
    if (field.match(/^(a1|a2|xff|dnsip|eip)$/) !== null) {
      eachCb = function(item, cb) {
        item.name = Pcap.inet_ntoa(item.name);
        process.nextTick(cb);
      };
    } else if (field.match(/^(ta|hh1|hh2)$/) !== null) {
      eachCb = function(item, cb) {
        Db.tagIdToName(item.name, function (name) {
          item.name = name;
          process.nextTick(cb);
        });
      };
    }

    Db.searchPrimary(indices, 'session', query, function(err, result) {
      var results = {bsqErr: bsqErr, items: [], graph: {}};
      if (err || result.error) {
        results.bsqErr = "Error performing query";
        console.log("spigraph.json error", err, (result?result.error:null));
        return res.send(results);
      }
      results.map = mapMerge(result.facets);

      histoMerge(req, query, result.facets, results.graph);
      results.map = mapMerge(result.facets);

      var facets = result.facets.field.terms;
      var interval = query.facets.dbHisto.histogram.interval;
      var filter;

      if (query.query.filtered.filter === undefined) {
        query.query.filtered.filter = {term: {}};
        filter = query.query.filtered.filter;
      } else {
        query.query.filtered.filter = {and: [{term: {}}, query.query.filtered.filter]};
        filter = query.query.filtered.filter.and[0];
      }

      delete query.facets.field;

      var queries = [];
      facets.forEach(function(item) {
        filter.term[field] = item.term;
        queries.push(JSON.stringify(query));
      });

      Db.msearch(indices, 'session', queries, function(err, result) {
        if (!result.responses) {
          return res.send(results);
        }

        for (var i = 0; i < result.responses.length; i++) {
          var r = {name: facets[i].term, count: facets[i].count, graph: {lpHisto: [], dbHisto: [], paHisto: []}};

          histoMerge(req, query, result.responses[i].facets, r.graph);
          if (r.graph.xmin === null) {
            r.graph.xmin = results.graph.xmin || results.graph.paHisto[0][0];
          }

          if (r.graph.xmax === null) {
            r.graph.xmax = results.graph.xmax || results.graph.paHisto[results.graph.paHisto.length-1][0];
          }

          r.map = mapMerge(result.responses[i].facets);
          results.items.push(r);
        }
        return res.send(results);
      });
    });
  });
});

app.get('/spiview.json', function(req, res) {
  if (req.query.spi === undefined) {
    return res.send({spi:{}});
  }

  var spiDataMaxIndices = +Config.get("spiDataMaxIndices", 1);

  if (req.query.date === '-1' && spiDataMaxIndices !== -1) {
    return res.send({spi: {}, bsqErr: "'All' date range not allowed for spiview query"});
  }

  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {spi: {},
               bsqErr: bsqErr.toString()
               };
      return res.send(r);
    }

    delete query.fields;
    delete query.sort;

    if (!query.facets) {
      query.facets = {};
    }

    req.query.spi.split(",").forEach(function (item) {
      var parts = item.split(":");
      query.facets[parts[0]] = {terms: {field: parts[0], size:parseInt(parts[1], 10)}};
    });
    query.size = 0;

    //console.log("spiview.json query", JSON.stringify(query), "indices", indices);

    var graph;
    var map;

    var indicesa = indices.split(",");
    if (spiDataMaxIndices !== -1 && indicesa.length > spiDataMaxIndices) {
      bsqErr = "To save ES from blowing up, reducing number of spi data indices searched from " + indicesa.length + " to " + spiDataMaxIndices + ".  This can be increased by setting spiDataMaxIndices in the config file.  Indices being searched: ";
      indices = indicesa.slice(-spiDataMaxIndices).join(",");
      bsqErr += indices;
    }

    async.parallel({
      spi: function (sessionsCb) {
        Db.searchPrimary(indices, 'session', query, function(err, result) {
          if (err || result.error) {
            console.log("spiview.json error", err, (result?result.error:null));
            sessionsCb(null, {});
            return;
          }

          if (result.facets.pr) {
            result.facets.pr.terms.forEach(function (item) {
              item.term = Pcap.protocol2Name(item.term);
            });
          }

          if (result.facets.dbHisto) {
            graph = {
              interval: query.facets.dbHisto.histogram.interval,
              lpHisto: [],
              dbHisto: [],
              paHisto: []
            };

            histoMerge(req, query, result.facets, graph);
            map = mapMerge(result.facets);
            delete result.facets.dbHisto;
            delete result.facets.paHisto;
            delete result.facets.map1;
            delete result.facets.map2;
          }

          sessionsCb(null, result.facets);
        });
      },
      health: function (healthCb) {
        Db.healthCache(healthCb);
      }
    },
    function(err, results) {
      function tags(container, field, doneCb, offset) {
        if (!container[field]) {
          return doneCb(null);
        }
        async.map(container[field].terms, function (item, cb) {
          Db.tagIdToName(item.term, function (name) {
            item.term = name.substring(offset);
            cb(null, item);
          });
        },
        function(err, tagsResults) {
          container[field].terms = tagsResults;
          doneCb(err);
        });
      }

      async.parallel([
        function(parallelCb) {
          tags(results.spi, "ta", parallelCb, 0);
        },
        function(parallelCb) {
          tags(results.spi, "hh", parallelCb, 12);
        },
        function(parallelCb) {
          tags(results.spi, "hh1", parallelCb, 12);
        },
        function(parallelCb) {
          tags(results.spi, "hh2", parallelCb, 12);
        }],
        function() {
          r = {health: results.health,
               spi: results.spi,
               graph: graph,
               map: map,
               bsqErr: bsqErr
          };
          try {
            res.send(r);
          } catch (c) {
          }
        }
      );
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

app.get('/connections.json', function(req, res) {

  req.query.iDisplayLength = req.query.iDisplayLength || "5000";
  buildSessionQuery(req, function(bsqErr, query, indices) {
    if (bsqErr) {
      var r = {};
      res.send(r);
      return;
    }

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
        console.log("connections.json error", err, results.graph.error);
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
          a1 = Pcap.inet_ntoa(f.a1);
          a2 = Pcap.inet_ntoa(f.a2);
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
          a1 = Pcap.inet_ntoa(f.a2);
          a2 = Pcap.inet_ntoa(f.a1);
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
        console.log("sessions.csv error", err, (result?result.error:null));
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

        res.write(pr + ", " + f.fp + ", " + f.lp + ", " + Pcap.inet_ntoa(f.a1) + ", " + f.p1 + ", " + (f.g1||"") + ", "  + Pcap.inet_ntoa(f.a2) + ", " + f.p2 + ", " + (f.g2||"") + ", " + f.pa + ", " + f.by + ", " + f.db + ", " + f.no + "\r\n");
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

      /* Need the nextTick so we don't blow max stack frames */
      var eachCb = function (item, cb) {process.nextTick(cb);};
      if (req.query.field.match(/^(a1|a2|xff|dnsip|eip)$/) !== null) {
        eachCb = function(item, cb) {
          item.term = Pcap.inet_ntoa(item.term);
          process.nextTick(cb);
        };
      } else if (req.query.field.match(/^(ta|hh1|hh2)$/) !== null) {
        eachCb = function(item, cb) {
          Db.tagIdToName(item.term, function (name) {
            item.term = name;
            process.nextTick(cb);
          });
        };
      }

      async.forEachSeries(result.facets.facets.terms, eachCb, function () {
        result.facets.facets.terms.forEach(function(item) {
          res.write(""+item.term);
          if (doCounts) {
            res.write(", " + item.count);
          }
          res.write("\n");
        });
        res.end();
      });
    });
  });
});

function processSessionId(id, headerCb, packetCb, endCb, maxPackets) {
  function processFile(pcap, pos, nextCb) {
    pcap.readPacket(pos, function(packet) {
      if (!packet) {
        return endCb("Error loading data for session " + id, null);
      }
      return packetCb(pcap, packet, nextCb);
    });
  }

  Db.get('sessions-' + id.substr(0,id.indexOf('-')), 'session', id, function(err, session) {
    if (err || !session.exists) {
      console.log("session get error", err, session);
      return endCb("Not Found", null);
    }

    if (maxPackets && session._source.ps.length > maxPackets) {
      session._source.ps.length = maxPackets;
    }

    /* Old Format: Every item in array had file num (top 28 bits) and file pos (lower 36 bits)
     * New Format: Negative numbers are file numbers until next neg number, otherwise file pos */
    var newFormat = false;
    var pcap = null;
    var fileNum;
    async.forEachSeries(session._source.ps, function(item, nextCb) {
      var pos;

      if (item < 0) {
        newFormat = true;
        fileNum = item * -1;
        return nextCb(null);
      } else if (newFormat) {
        pos  = item;
      } else  {
        // javascript doesn't have 64bit bitwise operations
        fileNum = Math.floor(item / 0xfffffffff);
        pos  = item % 0x1000000000;
      }

      if (pcap === null || pcap.fileNum !== fileNum) {
        if (pcap) {
          pcap.close();
        }

        Db.fileIdToFile(session._source.no, fileNum, function(file) {
          if (!file) {
            console.log("ERROR - File mapping not found in DB", session._source.no + '-' + fileNum);
            return nextCb("File mapping not found in DB " + session._source.no + '-' + fileNum);
          }
          pcap = new Pcap(file.name);
          pcap.fileNum = fileNum;
          pcap.open(function (err) {
            if (err) {
              console.log("ERROR - Couldn't open file ", err);
              return nextCb("Couldn't open file " + err);
            }
            if (headerCb) {
              pcap.readHeader(headerCb);
              headerCb = null;
            }
            processFile(pcap, pos, nextCb);
          });
        });
      } else {
        processFile(pcap, pos, nextCb);
      }
    },
    function (pcapErr, results)
    {
      if (pcap) {
        pcap.close();
      }

      function tags(container, field, doneCb, offset) {
        if (!container[field]) {
          return doneCb(null);
        }
        async.map(container[field], function (item, cb) {
          Db.tagIdToName(item, function (name) {
            cb(null, name.substring(offset));
          });
        },
        function(err, results) {
          container[field] = results;
          doneCb(err);
        });
      }

      async.parallel([
        function(parallelCb) {
          if (!session._source.ta) {
            session._source.ta = [];
            return parallelCb(null);
          }
          tags(session._source, "ta", parallelCb, 0);
        },
        function(parallelCb) {
          tags(session._source, "hh", parallelCb, 12);
        },
        function(parallelCb) {
          tags(session._source, "hh1", parallelCb, 12);
        },
        function(parallelCb) {
          tags(session._source, "hh2", parallelCb, 12);
        },
        function(parallelCb) {
          var files = [];
          async.forEachSeries(session._source.fs, function (item, cb) {
            Db.fileIdToFile(session._source.no, item, function (file) {
              if (file && file.locked === 1) {
                files.push(file.name);
              }
              cb(null);
            });
          },
          function(err) {
            session._source.fs = files;
            parallelCb(err);
          });
        }],
        function(err, results) {
          endCb(pcapErr, session._source);
        }
      );
    });
  });
}

function processSessionIdAndDecode(id, numPackets, doneCb) {
  var packets = [];
  processSessionId(id, null, function (pcap, buffer, cb) {
    var obj = {};
    if (buffer.length > 16) {
      pcap.decode(buffer, obj);
    } else {
      obj = {ip: {p: ""}};
    }
    packets.push(obj);
    cb(null);
  },
  function(err, session) {
    if (err) {
      return doneCb("error");
    }
    if (packets.length === 0) {
      return doneCb(null, session, []);
    } else if (packets[0].ip.p === 1) {
      Pcap.reassemble_icmp(packets, function(err, results) {
        return doneCb(err, session, results);
      });
    } else if (packets[0].ip.p === 6) {
      Pcap.reassemble_tcp(packets, Pcap.inet_ntoa(session.a1) + ':' + session.p1, function(err, results) {
        return doneCb(err, session, results);
      });
    } else if (packets[0].ip.p === 17) {
      Pcap.reassemble_udp(packets, function(err, results) {
        return doneCb(err, session, results);
      });
    } else {
      return doneCb(null, session, []);
    }
  },
  numPackets);
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
    outgoing[r]= {ts: incoming[r].ts, html: "", bytes:0};
    for (var p = 0; p < incoming[r].pieces.length; p++) {
      outgoing[r].bytes += incoming[r].pieces[p].raw.length;
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
          outgoing[r].html += "<a class=\"imagetag-" + session.id + "\" href=\"" + url + "\">" + incoming[r].pieces[p].bodyName + "</a>";
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
      outgoing[pos] = {ts: incoming[pos].ts, pieces:[{raw: buf}]};
      return;
    }

    // Copy over the headers
    if (!outgoing[pos]) {
      outgoing[pos] = {ts: incoming[pos].ts, pieces:[{raw: buf.slice(0, start)}]};
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
      outgoing[pos] = {ts: incoming[pos].ts, pieces: [{raw: incoming[pos].data}]};
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
      outgoing[pos] = {ts: incoming[pos].ts, pieces:[{raw: item.data}]};
      process.nextTick(nextCb);
    } else {
      parsers[(pos%2)].nextCb = nextCb;
      var out = parsers[(pos%2)].execute(item.data, 0, item.data.length);
      if (typeof out === "object") {
        outgoing[pos] = {ts: incoming[pos].ts, pieces:[{raw: item.data}]};
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
      outgoing[pos] = {ts: incoming[pos].ts, pieces: [{bodyNum: bodyNum, bodyType:"image", bodyName:"image" + bodyNum}]};
    } else {
      outgoing[pos] = {ts: incoming[pos].ts, pieces: [{bodyNum: bodyNum, bodyType:"file", bodyName:"file" + bodyNum}]};
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
      outgoing[pos] = {ts: incoming[pos].ts, pieces: [{raw: incoming[pos].data}]};
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
      outgoing[p] = {ts: incoming[p].ts, pieces:[{raw: item.data}]};
    } else {
      var out = parsers[(p%2)].execute(item.data, 0, item.data.length);
      if (typeof out === "object") {
        outgoing[p] = {ts: incoming[p].ts, pieces:[{raw: item.data}]};
        console.log("ERROR", out);
      }

      if (!outgoing[p]) {
        outgoing[p] = {ts: incoming[p].ts, pieces: [{raw: incoming[p].data}]};
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
          if (findBody === bodyNum) {
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
  for (p = 0; p < incoming.length; p++) {
    if (incoming[p].data.length === 0) {
      outgoing[p] = {ts: incoming[p].ts, pieces:[{raw: incoming[p].data}]};
    } else {
      outgoing[p] = {ts: incoming[p].ts, pieces: parse(incoming[p].data, p)};
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
  if ((results[0].data.length >= 4 && results[0].data.slice(0,4).toString() === "HTTP") ||
      (results[1] && results[1].data.length >= 4 && results[1].data.slice(0,4).toString() === "HTTP")) {
    return imageDecodeHTTP(req, res, session, results, findBody);
  }

  if ((results[0].data.length >= 4 && results[0].data.slice(0,4).toString().match(/(HELO|EHLO)/)) ||
      (results[1] && results[1].data.length >= 4 && results[1].data.slice(0,4).toString().match(/(HELO|EHLO)/)) ||
      (results[2] && results[1].data.length >= 4 && results[2].data.slice(0,4).toString().match(/(HELO|EHLO)/))) {
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
    outgoing.push({pieces: [{raw: incoming[r].data}], ts: incoming[r].ts});
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
  processSessionId(req.params.id, null, function (pcap, buffer, cb) {
    var obj = {};
    if (buffer.length > 16) {
      pcap.decode(buffer, obj);
    } else {
      obj = {ip: {p: "Empty"}};
    }
    packets.push(obj);
    cb(null);
  },
  function(err, session) {
    if (err && session === null) {
      return res.send("Error " +  err);
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
    if (session.pr) {
      session.pr = Pcap.protocol2Name(session.pr);
    }
    //console.log("session", util.inspect(session, false, 15));
    /* Now reassembly the packets */
    if (packets.length === 0) {
      localSessionDetailReturn(req, res, session, [{data: err || "No pcap data found"}]);
    } else if (packets[0].ip.p === 1) {
      Pcap.reassemble_icmp(packets, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else if (packets[0].ip.p === 6) {
      Pcap.reassemble_tcp(packets, Pcap.inet_ntoa(session.a1) + ':' + session.p1, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else if (packets[0].ip.p === 17) {
      Pcap.reassemble_udp(packets, function(err, results) {
        localSessionDetailReturn(req, res, session, results);
      });
    } else {
      localSessionDetailReturn(req, res, session, [{data: "Unknown ip.p=" + packets[0].ip.p}]);
    }
  },
  req.query.needimage === "true"?10000:400);
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
    processSessionIdAndDecode(req.params.id, 10000, function(err, session, results) {
      if (err) {
        return res.send("Error");
      }
      if (req.params.bodyType === "file") {
        res.setHeader("Content-Type", "application/force-download");
      }
      return imageDecode(req, res, session, results, +req.params.bodyNum);
    });
  },
  function () {
    proxyRequest(req, res);
  });
});

app.get('/:nodeName/:id/bodypng/:bodyType/:bodyNum/:bodyName', function(req, res) {
  isLocalView(req.params.nodeName, function () {
    if (!Png) {
      return res.send (emptyPNG);
    }
    processSessionIdAndDecode(req.params.id, 10000, function(err, session, results) {
      if (err) {
        return res.send (emptyPNG);
      }
      res.setHeader("Content-Type", "image/png");
      var newres = {
        finished: false,
        fullbuf: new Buffer(0),
        write: function(buf) {
          this.fullbuf = Buffer.concat([this.fullbuf, buf]);
        },
        end: function(buf) {
          this.finished = true;
          if (buf) {this.write(buf);}
          if (this.fullbuf.length === 0) {
            return res.send (emptyPNG);
          }
          var png = new Png(this.fullbuf, PNG_LINE_WIDTH, Math.ceil(this.fullbuf.length/PNG_LINE_WIDTH), 'gray');
          var png_image = png.encodeSync();

          res.send(png_image);
        }
      };
      return imageDecode(req, newres, session, results, +req.params.bodyNum);
    });
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
  function (pcap, buffer, cb) {
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

app.get('/:nodeName/raw/:id.png', function(req, res) {
  noCache(req, res);

  res.setHeader("Content-Type", "image/png");

  var PNG_LINE_WIDTH = 256;

  isLocalView(req.params.nodeName, function () {
    if (!Png) {
      return res.send (emptyPNG);
    }

    processSessionIdAndDecode(req.params.id, 100, function(err, session, results) {
      if (err) {
        return res.send (emptyPNG);
      }
      var size = 0;
      var i;
      for (i = (req.query.type !== 'dst'?0:1); i < results.length; i+=2) {
        size += results[i].data.length + 2*PNG_LINE_WIDTH - (results[i].data.length % PNG_LINE_WIDTH);
      }
      var buffer = new Buffer(size);
      var pos = 0;
      if (size === 0) {
        return res.send (emptyPNG);
      }
      for (i = (req.query.type !== 'dst'?0:1); i < results.length; i+=2) {
        results[i].data.copy(buffer, pos);
        pos += results[i].data.length;
        var fillpos = pos;
        pos += 2*PNG_LINE_WIDTH - (results[i].data.length % PNG_LINE_WIDTH);
        buffer.fill(0xff, fillpos, pos);
      }

      var png = new Png(buffer, PNG_LINE_WIDTH, (size/PNG_LINE_WIDTH)-1, 'gray');
      var png_image = png.encodeSync();

      res.send(png_image);
    });
  },
  function() {
    proxyRequest(req, res);
  });
});

app.get('/:nodeName/raw/:id', function(req, res) {
  noCache(req, res);

  res.setHeader("Content-Type", "application/vnd.tcpdump.pcap");
  res.statusCode = 200;

  isLocalView(req.params.nodeName, function () {
    processSessionIdAndDecode(req.params.id, 10000, function(err, session, results) {
      if (err) {
        return res.send("Error");
      }
      for (var i = (req.query.type !== 'dst'?0:1); i < results.length; i+=2) {
        res.write(results[i].data);
      }
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

  if (req.body.userId.match(/[^\w.-]/)) {
    return res.send(JSON.stringify({success: false, text: "User id must be word characters"}));
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
      console.log("Adding duplicate user", err, user);
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
      console.log("update user failed", err, user);
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
  function error(text) {
    return res.send(JSON.stringify({success: false, text: text}));
  }

  if (Config.get("disableChangePassword", false)) {
    return error("Disabled");
  }

  if (!req.body.newPassword || req.body.newPassword.length < 3) {
    return error("New password needs to be at least 2 characters");
  }

  if (!req.body.token) {
    return error("Missing token");
  }

  var token = Config.auth2obj(req.body.token);
  if (Math.abs(Date.now() - token.date) > 120000 || token.pid !== process.pid) { // Request has to be +- 120 seconds and same pid
    console.log("bad token", token);
    return error("Try reloading page");
  }

  if (token.cp && (req.user.passStore !== Config.pass2store(req.user.userId, req.body.currentPassword) ||
                   token.userId !== req.user.userId)) {
    return error("Current password mismatch");
  }

  Db.get("users", 'user', token.userId, function(err, user) {
    if (err || !user.exists) {
      console.log("changePassword failed", err, user);
      return error("Unknown user");
    }
    user = user._source;
    user.passStore = Config.pass2store(user.userId, req.body.newPassword);
    Db.indexNow("users", "user", user.userId, user, function(err, info) {
      if (err) {
        console.log(err, info);
        return error("Update failed");
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

