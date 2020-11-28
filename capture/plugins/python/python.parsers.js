const plugin = require('./python/viewer/python.parsers.plugin');

exports.init = function (Config, emitter, api) { 

    plugin.init(Config,emitter, api)
        
}