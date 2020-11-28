const path = require('path');
const appRoot = path.dirname(require.main.filename);

const decode = require(`${appRoot}/decode.js`)
const through = require(`${appRoot}/node_modules/through2`);

const channel = require('./python.parsers.channel');
const html = require('./python.parsers.html');

class Plugin
{
    constructor(module, classifier, dispatcherClass) 
    {
        this.channel = new channel(`./parsers/python/${module}.py`);
        this.classifier = classifier;
        this.dispatcher = new dispatcherClass(this.channel);
    }

    close()
    {
        this.channel.close();
    }

    async _call(method,args)
    {
        this.channel.writeCString(method);
        this.channel.writeInt32(args.length);
        for (let i = 0; i < args.length; i++) 
        {
            this._writeObject(args[i]);
        }
        await this._dispatch();
    }

    async _dispatch()
    {
        while(true)
        {
            var callback = await this.channel.readCString();            
            if(callback == 'return')
            {
                return;
            }
            else
            {
                var call = callback;
                var argc = await this.channel.readInt32();
                var args = [];
                for (let i = 0; i < argc; i++) {   
                    args.push(await this._readObject());           
                }
                await this.dispatcher[call].apply(this.dispatcher, args);
            }
        }
    }

    async _readObject()
    {
        var type = await this.channel.readCString();
        if(type == 'string')
        {
            return await this.channel.readCString();
        }
        else if(type == 'data')
        {
            return await this.channel.readData();
        }
        else if(type == 'int32')
        {
            return await this.channel.readInt32();
        }
        else if(type == 'DataFrame')
        {
            return { data: await this.channel.readData(), html: await this.channel.readCString() };
        }
        else 
        {
            throw Error(`Unknown type: ${type}`);
        }
    }

    _writeObject(obj)
    {
        if(typeof(obj) === 'string' || obj instanceof String)
        {
            this.channel.writeCString('string');
            this.channel.writeCString(obj);
        }
        else if(typeof(obj)  == 'number')
        {
            this.channel.writeCString('int32');
            this.channel.writeInt32(obj);
        }
        else if(obj instanceof Buffer)
        {
            this.channel.writeCString('data');
            this.channel.writeData(obj);
        }
        else
        {
            throw Error(`Unknown type: ${typeof(obj)}`);
        }
    }
}

class PythonPlugin extends Plugin
{
    constructor(module, classifier, decoder)
    {
        super(module, classifier || module, PythonPluginDispatcher)
        this.decoder = decoder
    }

    async decode(data, direction)
    {
        await this._call('moloch_decoder_decode', [this.classifier, data, direction, this.decoder]);
        return await this._readObject();
    }
}

class PythonPluginDispatcher
{
    constructor(channel)
    { 
        this._channel = channel;
        this.htmlDecoder = null;
    }

    async viewer_toHtml(data)
    {        
        var html = await this.htmlDecoder(data);
        this._channel.writeCString(html)
    }
}

function createPythonDecoder(options)
{
    key = 'ITEM-PYTHON';
    var stream = through.obj(async function(item, encoding, callback) { 

        var frame = await this.plugin.decode(item.data, item.client); 
        item.data = frame.data;
        item.html = frame.html;
        this.push(item);
        callback(); 
        
    }, function(callback) {
        this.plugin.close();
        callback();
    })
    
    stream.plugin = new PythonPlugin(options[key].module, options[key].classifier, options[key].decoder);
    stream.plugin.dispatcher.htmlDecoder = html.createDecoder(options,key);

    return stream;
}

function registerPythonDecoder()
{
    decode.register('ITEM-PYTHON', createPythonDecoder);
}

exports.init = function (Config, emitter, api) { 

    registerPythonDecoder();
        
}

