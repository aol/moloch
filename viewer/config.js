/******************************************************************************/
/* config.js -- Code dealing with the config file, command line arguments, 
 *              and dropping privileges
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

//////////////////////////////////////////////////////////////////////////////////
//// Command Line Parsing
//////////////////////////////////////////////////////////////////////////////////
var ini    = require('iniparser'),
    os     = require('os'),
    fs     = require('fs'),
    crypto = require('crypto');

var internals = {
    configFile: "/data/moloch/etc/config.ini",
    nodeName: os.hostname().split(".")[0],
    fields: [],
    fieldsMap: {}
  };

function processArgs() {
  var i;
  var args = [];
  for (i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === "-c") {
      i++;
      internals.configFile = process.argv[i];
    } else if (process.argv[i] === "-n") {
      i++;
      internals.nodeName = process.argv[i];
    } else {
      args.push(process.argv[i]);
    }
  }
  process.argv = args;
}
processArgs();

//////////////////////////////////////////////////////////////////////////////////
// Encryption stuff
//////////////////////////////////////////////////////////////////////////////////
exports.md5 = function (str, encoding){
  return crypto
    .createHash('md5')
    .update(str)
    .digest(encoding || 'hex');
};

exports.pass2store = function(userid, password) {
  var m = exports.md5(userid + ":" + exports.getFull("default", "httpRealm", "Moloch") + ":" + password);
  var c = crypto.createCipher('aes192', exports.getFull("default", "passwordSecret", "password"));
  var e = c.update(m, "binary", "hex");
  e += c.final("hex");
  return e;
};

exports.store2ha1 = function(passstore) {
  var c = crypto.createDecipher('aes192', exports.getFull("default", "passwordSecret", "password"));
  var d = c.update(passstore, "hex", "binary");
  d += c.final("binary");
  return d;
};

exports.obj2auth = function(obj) {
  var c = crypto.createCipher('aes192', exports.getFull("default", "passwordSecret", "password"));
  var e = c.update(JSON.stringify(obj), "binary", "hex");
  e += c.final("hex");
  return e;
};

exports.auth2obj = function(auth) {
  var c = crypto.createDecipher('aes192', exports.getFull("default", "passwordSecret", "password"));
  var d = c.update(auth, "hex", "binary");
  d += c.final("binary");
  return JSON.parse(d);
};

//////////////////////////////////////////////////////////////////////////////////
// Config File & Dropping Privileges
//////////////////////////////////////////////////////////////////////////////////

if (!fs.existsSync(internals.configFile)) {
  console.log("ERROR - Couldn't open config file '" + internals.configFile + "' maybe use the -c <configfile> option");
  process.exit(1);
}
internals.config = ini.parseSync(internals.configFile);


if (internals.config["default"] === undefined) {
  console.log("ERROR - [default] section missing from", internals.configFile);
  process.exit(1);
}

exports.getFull = function(node, key, defaultValue) {
  if (internals.config[node] && internals.config[node][key] !== undefined ) {
    return internals.config[node][key];
  }

  if (internals.config[node] && internals.config[node].nodeClass && internals.config[internals.config[node].nodeClass] && internals.config[internals.config[node].nodeClass][key]) {
    return internals.config[internals.config[node].nodeClass][key];
  }

  if (internals.config["default"][key]) {
    return internals.config["default"][key];
  }

  return defaultValue;
};

exports.get = function(key, defaultValue) {
    return exports.getFull(internals.nodeName, key, defaultValue);
};

function dropPrivileges() {
  if (process.getuid() !== 0) {
    return;
  }

  var group = exports.get("dropGroup", null);
  if (group !== null) {
    process.setgid(group);
  }

  var user = exports.get("dropUser", null);
  if (user !== null) {
    process.setuid(user);
  }
}

exports.getConfigFile = function() {
  return internals.configFile;
};

exports.isHTTPS = function(node) {
  return exports.getFull(node || internals.nodeName, "keyFile") &&
         exports.getFull(node || internals.nodeName, "certFile");
};

exports.basePath = function(node) {
  return exports.getFull(node || internals.nodeName, "webBasePath", "/");
};

exports.nodeName = function() {
  return internals.nodeName;
};

exports.keys = function(section) {
  if (internals.config[section] === undefined) {return [];}
  return Object.keys(internals.config[section]);
};

exports.headers = function(section) {
  if (internals.config[section] === undefined) {return [];}
  var keys = Object.keys(internals.config[section]);
  if (!keys) {return [];}
  var headers = Object.keys(internals.config[section]).map(function(key) {
    var obj = {name: key};
    internals.config[section][key].split(';').forEach(function(element) {
      var parts = element.split(":");
      if (parts && parts.length === 2) {
        if (parts[1] === "true") {
          parts[1] = true;
        } else if (parts[1] === "false") {
          parts[1] = false;
        }
        obj[parts[0]] = parts[1];
      }
    });
    return obj;
  });

  return headers;
};

dropPrivileges();

//////////////////////////////////////////////////////////////////////////////////
// Fields
//////////////////////////////////////////////////////////////////////////////////
function addField(db, exp, cat, type, help) {
  internals.fields.push({db: db, exp: exp, cat: cat, type: type, help:help});
  internals.fieldsMap[exp] = {db: db, cat: cat, type: type};
}

exports.getFields = function() {
  return internals.fields;
};

exports.getFieldsMap = function() {
  return internals.fieldsMap;
};

addField(null, "ip", "general", "ip", "Shorthand for ip.src, ip.dst, ip.dns, ip.email, and ip.xff");
addField("a1", "ip.src", "general", "ip", "Source ip");
addField("a2", "ip.dst", "general", "ip", "Destination ip");
addField("dnsip", "ip.dns", "dns", "ip", "IP from DNS result");
addField("dnsipcnt", "ip.dns.cnt", "dns", "integer", "Unique number of IPs from DNS result");
addField("eip", "ip.email", "email", "ip", "IP from email hop");
addField("eipcnt", "ip.email.cnt", "email", "integer", "Unqiue number of IPs from email hop");
addField("xff", "ip.xff", "http", "ip", "IP from x-forwarded-for header");
addField("xffscnt", "ip.xff.cnt", "http", "integer", "Unique number of IPs from x-forwarded-for header");

addField(null, "port", "general", "integer", "Shorthand for port.src, port.dst");
addField("p1", "port.src", "general", "integer", "Source port");
addField("p2", "port.dst", "general", "integer", "Destination port");

addField(null, "asn", "general", "textfield", "Shorthand for the GeoIP ASNum string from the asn.src, asn.dst, asn.dns, asn.email, or asn.xff fields");
addField("as1", "asn.src", "general", "textfield", "GeoIP ASNum string calculated from the source ip address");
addField("as2", "asn.dst", "general", "textfield", "GeoIP ASNum string calculated from the destination ip address");
addField("asdnsip", "asn.dns", "dns", "textfield", "GeoIP ASNum string calculated from the DNS result ip address");
addField("aseip", "asn.email", "email", "textfield", "GeoIP ASNum string calculated from the SMTP ip address");
addField("asxff", "asn.xff", "http", "textfield", "GeoIP ASNum string calculated from the HTTP x-forwarded-for header");

addField(null, "country", "general", "uptermfield", "Shorthand for the GeoIP string from the country.src, country.dst, country.dns, country.email, or country.xff fields");
addField("g1", "country.src", "general", "uptermfield", "GeoIP country string string calculated from the source ip address");
addField("g2", "country.dst", "general", "uptermfield", "GeoIP country string string calculated from the destination ip address");
addField("gdnsip", "country.dns", "dns", "uptermfield", "GeoIP country string string calculated from the DNS result ip address");
addField("geip", "country.email", "email", "uptermfield", "GeoIP country string string calculated from the SMTP ip address");
addField("gxff", "country.xff", "http", "uptermfield", "GeoIP country string string calculated from the HTTP x-forwarded-for header");

addField("by", "bytes", "general", "integer", "Total number of raw bytes sent AND received in a session");
addField("db", "databytes", "general", "integer", "Total number of data bytes sent AND received in a session");
addField("pa", "packets", "general", "integer", "Total number of packets sent AND received in a session");
addField("pr", "protocol", "general", "integer", "IP protocol number");
addField("id", "id", "general", "termfield", "Moloch ID for the session");
addField("ro", "rootId", "general", "termfield", "Moloch ID of the first session in a multi session stream");
addField("no", "node", "general", "termfield", "Moloch node name the session was recorded on");
addField("ta", "tags", "general", "lotermfield", "Tests if the session has the tag");
addField("tacnt", "tags.cnt", "general", "integer", "Number of unique tags");
addField("user", "user", "general", "lotermfield", "External user set for session");
addField(null, "file", "general", "termfield", "File name of offline added files");

addField(null, "host", "general", "termfield", "Shorthand for host.dns, host.email. host.http");
addField("ho", "host.http", "http", "lotermfield", "HTTP host header field");
addField("hocnt", "host.http.cnt", "http", "integer", "Unique number of HTTP host headers");
addField("dnsho", "host.dns", "dns", "lotermfield", "DNS host response");
addField("dnshocnt", "host.dns.cnt", "dns", "integer", "Unique number DNS host responses");
addField("eho", "host.email", "email", "lotermfield", "EMAIL host proxy");
addField("ehocnt", "host.email.cnt", "email", "integer", "Unique number of EMAIL host proxies");

addField("tls.iCn", "cert.issuer.cn", "cert", "lotermfield", "Issuer's common name");
addField("tls.iOn", "cert.issuer.on", "cert", "lotextfield", "Issuer's organization name");
addField("tls.sCn", "cert.subject.cn", "cert", "lotermfield", "Subject's common name");
addField("tls.sOn", "cert.subject.on", "cert", "lotextfield", "Subject's organization name");
addField("tls.sn",  "cert.serial", "cert", "termfield", "Serial Number");
addField("tls.alt",  "cert.alt", "cert", "lotermfield", "Alternative names");
addField("tls.altcnt", "cert.alt.cnt", "cert", "integer", "Number of unique alternative names");
addField("tlscnt", "cert.cnt", "cert", "integer", "Number of unique certificates in session");

addField("ircnck",  "irc.nick", "irc", "termfield", "Nicknames set");
addField("ircnckcnt",  "irc.nick.cnt", "irc", "integer", "Unique number of nicknames set");
addField("ircch",  "irc.channel", "irc", "termfield", "Channels joined ");
addField("ircchcnt",  "irc.channel.cnt", "irc", "integer", "Unique number of channels joined");

addField("ect", "email.content-type", "email", "termfield", "Content-Type header of message");
addField("ectcnt", "email.content-type.cnt", "email", "integer", "Unique number of content-type headers");
addField("eid", "email.message-id", "email", "termfield", "Message-Id header of message");
addField("eidcnt", "email.message-id.cnt", "email", "integer", "Unique number of Message-Id headers");
addField("edst", "email.dst", "email", "lotermfield", "To and CC email destinations");
addField("edstcnt", "email.dst.cnt", "email", "integer", "Unique number of To and CC email destinations");
addField("esrc", "email.src", "email", "lotermfield", "Email from address");
addField("esrccnt", "email.src.cnt", "email", "integer", "Unique number of email from addresses");
addField("efn", "email.fn", "email", "termfield", "Email attachment filenames");
addField("efncnt", "email.fn.cnt", "email", "integer", "Unique number of email attachment filenames");
addField("emd5", "email.md5", "email", "lotermfield", "Email md5 of attachments ");
addField("emd5cnt", "email.md5.cnt", "email", "integer", "Unique number of md5s of attachments");
addField("emv", "email.mime-version", "email", "lotermfield", "Email mime-version header");
addField("emvcnt", "email.mime-version.cnt", "email", "integer", "Unique number of mime-version header values");
addField("esub", "email.subject", "email", "lotextfield", "Email subject header");
addField("esubcnt", "email.subject.cnt", "email", "integer", "Unique number of subject header values");
addField("eua", "email.x-mailer", "email", "lotextfield", "Email x-mailer header");
addField("euacnt", "email.x-mailer.cnt", "email", "integer", "Unique number of x-mailer header values");

addField(null, "http.hasheader", "http", "lotermfield", "Shorthand for http.hasheader.src or http.hasheader.dst");
addField("hh1", "http.hasheader.src", "http", "lotermfield", "Check if the request has a header present");
addField("hh1cnt", "http.hasheader.src.cnt", "http", "integer", "Unique number of headers the request has");
addField("hh2", "http.hasheader.dst", "http", "lotermfield", "Check if the response has a header present");
addField("hh2cnt", "http.hasheader.dst.cnt", "http", "integer", "Unique number of headers the response has");

addField("hmd5", "http.md5", "http", "termfield", "MD5 of http body response");
addField("hmd5cnt", "http.md5.cnt", "http", "integer", "Unique number of MD5 of http body responses");
addField(null, "http.version", "http", "termfield", "Shorthand for http.version.src or http.version.dst");
addField("hsver", "http.version.src", "http", "termfield", "Request HTTP version number");
addField("hsvercnt", "http.version.src.cnt", "http", "integer", "Unique number of request HTTP versions");
addField("hdver", "http.version.dst", "http", "termfield", "Response HTTP version number");
addField("hdvercnt", "http.version.src.cnt", "http", "integer", "Unique number of response HTTP versions");
addField("ua", "http.user-agent", "http", "textfield", "User-Agent header");
addField("uacnt", "http.user-agent.cnt", "http", "integer", "Unique number of User-Agent headers");
addField("us", "http.uri", "http", "textfield", "URIs for request");
addField("uscnt", "http.uri.cnt", "http", "integer", "Unique number of request URIs");

addField("sshkey", "ssh.key", "ssh", "termfield", "Base64 encoded host key");
addField("sshkeycnt", "ssh.key.cnt", "ssh", "integer", "Number of unique Base64 encoded host keys");
addField("sshver", "ssh.key", "ssh", "lotermfield", "SSH version string");
addField("sshvercnt", "ssh.key.cnt", "ssh", "integer", "Number of unique ssh version strings");

exports.headers("headers-http-request").forEach(function(item) {
  addField("hdrs.hreq-" + item.name + (item.type === "integer"?"":".snow"), "http." + item.name, "http", (item.type === "integer"?"integer":"textfield"), "Request header " + item.name);
  if (item.count === true) {
    addField("hdrs.hreq-" + item.name + "cnt", "http." + item.name + ".cnt", "http", "integer", "Unique number of request header " + item.name);
  }
});

exports.headers("headers-http-response").forEach(function(item) {
  addField("hdrs.hres-" + item.name + (item.type === "integer"?"":".snow"), "http." + item.name, "http", (item.type === "integer"?"integer":"textfield"), "Response header " + item.name);
  if (item.count === true) {
    addField("hdrs.hres-" + item.name + "cnt", "http." + item.name + ".cnt", "http", "integer", "Unique number of response header " + item.name);
  }
});

exports.headers("headers-email").forEach(function(item) {
  addField("hdrs.ehead-" + item.name + (item.type === "integer"?"":".snow"), "email." + item.name, "email", (item.type === "integer"?"integer":"textfield"), "Email header " + item.name);
  if (item.count === true) {
    addField("hdrs.ehead-" + item.name + "cnt", "email." + item.name + ".cnt", "http", "integer", "Unique number of email header " + item.name);
  }
});
