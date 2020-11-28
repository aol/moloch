import moloch
import struct
from itertools import cycle

def xor(data,key):
    if(type(key) == int):
        key = struct.pack('I',key)
    return bytes([ a ^ b for a,b in zip(data,cycle(key)) ])  

      
class KeyFrame(moloch.dataFrame):

    def __init__(self, data):
        super().__init__(data)
        (checksum,master,session) = struct.unpack("!III",data[:12]) 
        self.checksum = checksum
        self.masterkey = master ^ checksum
        self.sessionkey = session ^ self.masterkey 

    def isValid(self):
        return self.masterkey == 0xdeadbeaf

class SampleFrame(moloch.dataFrame):
    def __init__(self, key, data):
        super().__init__()
        self.header = HeaderFrame(key, data[0:4])
        if(len(data) >= self.header.length + 4):
            self.body = BodyFrame(key, data[4:4+self.header.length])
        else:
            self.body = None
    
    #if a frame consists of multiple nested frames you can supply them here
    def frames(self):
        return [self.header, self.body]

    #The data representing the current frame
    def data(self):
        return self.header.data() + self.body.data()
    
    def isValid(self):
        return self.body != None

class HeaderFrame(moloch.dataFrame):
    def __init__(self, key, data):
        super().__init__(xor(data,key))
        (length,) = struct.unpack("I",self._data)
        self.length = length
    
    def htmlHeader(self):
        return super().htmlHeader() + '(length: %s)' % self.length

class BodyFrame(moloch.dataFrame):
    def __init__(self, key, data):
        super().__init__(xor(data,key))   

    def isResponse(self):
        return len(self._data) > 16

    def request(self):
        return self._data[:16].rstrip()

    def response(self):
        return self._data[16:]    
    
    def htmlBody(self):
        if(self.isResponse() and self.request() == b'screen'):
            return moloch.htmlHelper.toImage(self._data[16:])
        elif(self.isResponse() and self.request() == b'passwd'):
            return moloch.htmlHelper.toDownload(self._data[16:], "Download /etc/passwd", 'passwd')
        else:
            return super().htmlBody()
  