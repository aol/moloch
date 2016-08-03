/******************************************************************************/
/*
 *
 * Copyright 2012-2016 AOL Inc. All rights reserved.
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
'use strict';

var request        = require('request')
  , wiseSource     = require('./wiseSource.js')
  , util           = require('util')
  ;

//////////////////////////////////////////////////////////////////////////////////
function PassiveTotalSource (api, section) {
  PassiveTotalSource.super_.call(this, api, section);
  this.waiting      = [];
  this.processing   = {};
}
util.inherits(PassiveTotalSource, wiseSource);

//////////////////////////////////////////////////////////////////////////////////
PassiveTotalSource.prototype.performQuery = function () {
  var self = this;

  if (self.waiting.length === 0) {
    return;
  }

  if (self.api.debug > 0) {
    console.log("PassiveTotal - Fetching %d", self.waiting.length);
  }

  var options = {
      url: 'https://api.passivetotal.org/v2/enrichment/bulk',
      body: {additional: ["osint", "malware"],
             query: self.waiting},
      auth: {
        user: self.user,
        pass: self.key
      },
      method: 'GET',
      json: true
  };

  var req = request(options, function(err, im, results) {
    if (err) {
      console.log("Error parsing for request:\n", options, "\nresults:\n", results);
      results = {results:{}};
    } 

    for (var resultname in results.results) {
      var result = results.results[resultname];
      var cbs = self.processing[resultname];
      if (!cbs) {
        return;
      }
      delete self.processing[resultname];

      var wiseResult;
      if (result.tags === undefined || result.tags.length === 0) {
        wiseResult = wiseSource.emptyResult;
      } else {
        var args = [];
        for (var i = 0; i < result.tags.length; i++) {
          if (typeof(result.tags[i]) === "string") {
            args.push(self.tagsField, result.tags[i]);
          }
        }
        
        wiseResult = {num: args.length/2, buffer: wiseSource.encode.apply(null, args)};
      }

      var cb;
      while ((cb = cbs.shift())) {
        cb(null, wiseResult);
      }
    }
  }).on('error', function (err) {
    console.log(err);
  });

  self.waiting.length = 0;
};
//////////////////////////////////////////////////////////////////////////////////
PassiveTotalSource.prototype.init = function() {
  this.key = this.api.getConfig("passivetotal", "key");
  this.user = this.api.getConfig("passivetotal", "user");
  if (this.key === undefined) {
    console.log("PassiveTotal - No key defined");
    return;
  }
  if (this.user === undefined) {
    console.log("PassiveTotal - No user defined");
    return;
  }

  this.api.addSource("passivetotal", this);
  setInterval(this.performQuery.bind(this), 500);

  var str = 
    "if (session.passivetotal)\n" +
    "  div.sessionDetailMeta.bold PassiveTotal\n" +
    "  dl.sessionDetailMeta\n" +
    "    +arrayList(session.passivetotal, 'tags-term', 'Tags', 'passivetotal.tags')\n";

  this.tagsField = this.api.addField("field:passivetotal.tags;db:passivetotal.tags-term;kind:termfield;friendly:Tags;help:PassiveTotal Tags;count:true");

  this.api.addView("passivetotal", str);
};

//////////////////////////////////////////////////////////////////////////////////
PassiveTotalSource.prototype.getDomain = function(domain, cb) {
  if (domain in this.processing) {
    this.processing[domain].push(cb);
    return;
  }

  this.processing[domain] = [cb];
  this.waiting.push(domain);
  if (this.waiting.length >= 25) {
    this.performQuery();
  }
};
//////////////////////////////////////////////////////////////////////////////////
PassiveTotalSource.prototype.getIp = PassiveTotalSource.prototype.getDomain;
//////////////////////////////////////////////////////////////////////////////////
var source;
exports.initSource = function(api) {
  source = new PassiveTotalSource(api, "passivetotal");
  source.init();
};
//////////////////////////////////////////////////////////////////////////////////
