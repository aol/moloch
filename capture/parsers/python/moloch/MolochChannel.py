# pylint: disable=method-hidden
import struct
import socket
import os
from .MolochTypes import *

class MolochChannel(object):

    __PIPEIN_FILENO = 3
    __PIPEOUT_FILENO = 4

    def __init__(self, fd_in = __PIPEIN_FILENO, fd_out = __PIPEOUT_FILENO):
        self.__pipeIn = os.fdopen(fd_in,'rb')
        self.__pipeOut = os.fdopen(fd_out,'wb')

    def readObject(self):
        object_type = self.readCString()
        if(object_type == "string"):
            return self.readCString()
        elif(object_type == "data"):
            return self.readData()
        elif(object_type == "int32"):        
            return self.readInt32()
        elif(object_type == "MolochSession"):
            return self.readMolochSession()
        else: raise Exception("Unknown object type: " + object_type)

    def readMolochSession(self): 
        return {
            "ip.src": in_addr(self.read(16)),
            "port.src": struct.unpack("<H",self.read(2))[0],
            "ip.dst": in_addr(self.read(16)),
            "port.dst": struct.unpack("<H",self.read(2))[0]
        }
    def readCString(self): return (self.readData()[:-1]).decode("utf-8")
    def readString(self): return self.readData().decode("utf-8")
    def readData(self): return self.read(self.readInt32())
    def readInt32(self): return struct.unpack("<I", self.read(4))[0]
    def read(self,size): 
        data = self.__pipeIn.read(size)
        if(len(data) == 0 and size > 0):
            raise EOFError()
        return data

    def writeObject(self, obj):
        if (isinstance(obj, int)):
            self.writeInt32Object(obj)
        elif (isinstance(obj, str) and str is not bytes):
            self.writeCStringObject(obj)
        elif (isinstance(obj, bytes) and str is not bytes):
            self.writeDataObject(obj)
        elif (isinstance(obj, IDataFrame)):
            self.writeDataFrameObject(obj)
        else: 
            raise Exception("Unknown object type: " + repr(type(obj)))

    def writeCStringObject(self, string):
        self.writeCString('string')
        self.writeCString(string)

    def writeDataObject(self, data):
        self.writeCString('data')
        self.writeData(data)

    def writeInt32Object(self, i):
        self.writeCString('int32')
        self.writeInt32(i)

    def writeDataFrameObject(self, dataframe):
        self.writeCString('DataFrame')
        self.writeData(dataframe.data)
        self.writeCString(dataframe.html)

    def writeCString(self,string): self.writeString(string + '\0')
    def writeString(self,string): self.writeData(string.encode('utf-8'))
    def writeData(self,data):
        self.writeInt32(len(data))
        self.write(data)  

    def writeInt32(self,i): self.write(struct.pack("<I",i))  
    def write(self,buffer): self.__pipeOut.write(buffer)

    def flush(self): self.__pipeOut.flush()

    @staticmethod
    def debug():
        import os
        import sys
        if('__debug__' in os.environ):            
            (_pathname, scriptname) = os.path.split(sys.argv[0])
            pipelog_dir = 'dev/logs' 
            if not os.path.exists(pipelog_dir):
               pipelog_dir = 'logs' 
            pipelog_file = '%s/%s.log' % (pipelog_dir,scriptname)
            
            if(os.environ['__debug__'] == 'client'):                  
                MolochChannel.__PIPEIN_FILENO = os.open(pipelog_file, os.O_RDONLY)
                MolochChannel.__PIPEOUT_FILENO = os.open(os.devnull, os.O_WRONLY)
                                
                init_old = MolochChannel.__init__
                def init_new(self, *args):
                    init_old(self, MolochChannel.__PIPEIN_FILENO, MolochChannel.__PIPEOUT_FILENO)
                MolochChannel.__init__ = init_new

            elif(os.environ['__debug__'] == 'server'):
                if(not os.path.exists('logs')): 
                    os.mkdir('logs')
                pipe_log = open(pipelog_file, "wb")
                try:
                    os.chmod(pipelog_file, int('666',8))
                except:
                    pass
                read_old = MolochChannel.read
                def read_new(self, size):
                    data = read_old(self, size)
                    pipe_log.write(data)
                    pipe_log.flush()
                    return data
                MolochChannel.read = read_new

class in_addr():
    def __init__(self, addr8):
        self.addr8 = addr8
        addr32 = struct.unpack("!IIII", addr8)
        self.ipv4 = (addr32[0] == 0 and addr32[1] == 0 and addr32[2] == 0xffff)
    
    def __str__(self):
        if(self.ipv4):
            return socket.inet_ntop(socket.AF_INET,self.addr8[12:])
        else:
            return socket.inet_ntop(socket.AF_INET6,self.addr8)

    def __repr__(self):
        return str(self)