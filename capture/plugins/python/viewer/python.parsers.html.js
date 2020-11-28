const path = require('path');
const appRoot = path.dirname(require.main.filename);
const decode = require(`${appRoot}/decode.js`)
const through = require(`${appRoot}/node_modules/through2`);

function createHtmlPipeline(options,key)
{
    var order = options.order.slice(options.order.indexOf(key)+1)
    order.pop(); //POP ITEM-CB 

    var input = through.obj();  
    pipeline = decode.createPipeline(options, order, input) 
    var output = pipeline.pop();
    return { in : input, out: output };
}

function createHtmlDecoder(options,key)
{
    return (data) => {
        return new Promise((resolve) => {
            var io = createHtmlPipeline(options,key);
            io.out.on('readable', () => {
                item = io.out.read()
                if(item)
                {
                    resolve(item.html);
                }
            })
            io.in.write({ data : data });
            io.in.end();
        });        
    }
}

module.exports.createDecoder = createHtmlDecoder

