const process = require("child_process");

class Channel 
{
    constructor(command) 
    {
        this.process = process.spawn(command,[], { cwd: '..', stdio : ['inherit','inherit','inherit','pipe','pipe'] });
        this.pipeOut = this.process.stdio[3]
        this.pipeIn = this.process.stdio[4]
    }

    close()
    {
        this.pipeOut.end();
    }

    async readCString() 
    { 
        var data = await this.readData();
        return data.toString("utf-8", 0, data.length-1);
    }
    async readString() 
    { 
        var data = await this.readData();
        return data.toString("utf-8"); 
    }
    async readData() 
    { 
        var len = await this.readInt32();
        return await this.read(len);
    }
    async readInt32()
    {
        var data = await this.read(4);
        return (data[0] << 0) | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    } 
    read(size)
    { 
        if(size == 0) return Promise.resolve(Buffer.alloc(0));
        return new Promise((accept, reject) => {
            var onReadable = () =>
            {
                var data = this.pipeIn.read(size);
                if(data !== null)
                {
                    this.pipeIn.removeListener('readable', onReadable);
                    this.pipeIn.removeListener('end', onEnd);
                    accept(data);
                    return true;
                }
                return false;
            }
            var onEnd = () =>
            {
                reject('EOF');
            }
            if(!onReadable())
            {
                this.pipeIn.on('readable', onReadable);
                this.pipeIn.on('end', onEnd);
            }
        })       
    }


    writeCString(string) { this.writeString(string + '\0'); }
    writeString(string) { this.writeData(Buffer.from(string)); }
    writeData(data) 
    {
        this.writeInt32(data.length);
        this.write(data);
    }
    writeInt32(i) 
    { 
        this.write(new Buffer.from([(i >> 0) & 0xFF, (i >> 8) & 0xFF, (i >> 16) & 0xFF, (i >> 24) & 0xFF])); 
    }  
    write(buffer)
    {
        this.pipeOut.write(buffer);
    }
}

module.exports = Channel;
