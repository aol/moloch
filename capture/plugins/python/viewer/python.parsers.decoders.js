const path = require('path');
const html = require('./python.parsers.html');
const appRoot = path.dirname(require.main.filename);

const flatten = require('array-flatten')
const decode = require(`${appRoot}/decode.js`)
const through = require(`${appRoot}/node_modules/through2`);

function registerDecoder(name, fn)
{
    key = `ITEM-${name.toUpperCase()}`;
    decode.register(key, through.ctor({objectMode: true}, function(item, encoding, callback_main) { 
        _that = this;
        var output = through.obj((item, encoding, callback_sub) => {            
            _that.push(item);
            callback_sub();
        },(callback_sub) => {
            callback_main()
            callback_sub();
        })

        htmlDecoder = html.createDecoder(this.options, key)
        fn(item, this.options[key], htmlDecoder, output)
    }));
}

module.exports.registerDecoder = registerDecoder

// sample decoder
// function someaction(item, options)
// {
//     var segments = Array.from(Array(Math.floor(item.data.length/4)).keys()).map(i => ({ header: 'Some header' + i.toString(), data: item.data.slice(i*4,i*4+4) }));
//     return segments;
// }

// registerDecoder('WINNTI', async (item, options, htmlDecoder, output) => {

//     var result = flatten([someaction(item,options)]);
    
//     for (let i = 0; i < result.length; i++) {
//         const obj = result[i];
//         obj.ts = item.ts;
//         obj.client = item.client;
//         obj.html = `<span>${obj.header}</span>${ await htmlDecoder(obj.data)}`
//         output.write(obj);
//     }
//     output.end();

// })