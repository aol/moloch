import moloch
from . import SampleFrames as SampleFrames

class SampleParser(moloch.parser):

    def __init__(self, fields, decoder):
        self.fields = fields
        self.decoder = decoder

    #Parse the data
    def parse(self, data, direction):

        frame = self.decoder.decode(data, direction)
        if(isinstance(frame, SampleFrames.SampleFrame)): 
            if(frame.body.isResponse()):
                self.fields.optcodes.add(frame.body.request().decode('utf-8'))
            
                if(frame.body.request() == b'hello'):
                    self.fields.hostname.add(frame.body.response().decode('utf-8'))
                elif(frame.body.request() == b'version'):
                    major,minor,patch = frame.body.response().decode('utf-8').split('.')
                    self.fields.majorVersion.add(int(major))
                    self.fields.minorVersion.add(int(minor))
                    self.fields.patchVersion.add(int(patch))
        
        #unregister when your finished
        #self.unregister()