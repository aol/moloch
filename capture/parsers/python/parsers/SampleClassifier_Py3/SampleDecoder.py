#!/usr/bin/env python3
import moloch
import struct
from . import SampleFrames



class SampleDecoder(moloch.decoder):

    masterkey = 0xdeadbeaf

    def __init__(self):
        super().__init__()
        self.sessionkey = None
        self.lastcmd = None
        self.data = [b'',b'']

    def consume(self, direction, length):
        self.data[direction] = self.data[direction][length:]
        return self.data[direction]

    def update(self, direction, data):
        self.data[direction] += data
        return self.data[direction]
        
    #Decode a datastream into a instance of a moloch.dataFrame 
    def decode(self, data, direction):

        data = self.update(direction, data)
        
        if(self.sessionkey == None):

            if(len(data) >= 12):
                frame = SampleFrames.KeyFrame(data[:12])
                self.sessionkey = frame.sessionkey
                self.consume(direction,12)
                return frame

        else:
            
            if(len(data) >= 4):
                frame = SampleFrames.SampleFrame(self.sessionkey, data)
                if(frame.isValid()):
                    self.consume(direction,frame.header.length+4)
                    return frame


    #sample method to quicly validate the header of the stream
    @staticmethod
    def validHeader(data): 
        
        if(len(data) == 12): 
            (checksum,master,session) = struct.unpack("!III",data[:12]) 
            return master^SampleDecoder.masterkey == checksum
            
        return False