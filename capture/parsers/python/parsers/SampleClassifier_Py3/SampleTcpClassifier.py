#!/usr/bin/env python3

import moloch
from .SampleDecoder import SampleDecoder
from .SampleParser import SampleParser

#Create a tcpClassifier (use moloch.udpClassifier for udp traffic)
class SampleTcpClassifier(moloch.tcpClassifier):
  
    def __init__(self):
        super().__init__(offset=12,match=bytes())

    def define(self):
        # #Define the moloch data fields here
        self.fields.majorVersion = self.defineField("sample", moloch.field.KIND.Integer, 
            "sample.version.major", "Sample Major Version", "sample.version.major", "Sample Major Version", 
            moloch.field.TYPE.Int, moloch.field.FLAGS.Linked_Sessions)
        self.fields.minorVersion = self.defineField("sample", moloch.field.KIND.Integer, 
            "sample.version.minor", "Sample Minor Version", "sample.version.minor", "Sample Minor Version", 
            moloch.field.TYPE.Int, moloch.field.FLAGS.Linked_Sessions)
        self.fields.patchVersion = self.defineField("sample", moloch.field.KIND.Integer, 
            "sample.version.patch", "Sample Patch Version", "sample.version.patch", "Sample Patch Version", 
            moloch.field.TYPE.Int, moloch.field.FLAGS.Linked_Sessions)
            
        self.fields.hostname = self.defineField("sample", moloch.field.KIND.Termfield, 
            "sample.hostname", "Hostname", "sample.hostname", "Hostname", 
            moloch.field.TYPE.String, moloch.field.FLAGS.Linked_Sessions)

        self.fields.optcodes = self.defineField("sample", moloch.field.KIND.Termfield, 
            "sample.optcodes", "Optcodes", "sample.optcodes", "Optcodes", 
            moloch.field.TYPE.String_GHash, moloch.field.FLAGS.Linked_Sessions)

    #This function should be as lightweight as possible
    def classify(self, session, data, direction):
        # #classify the head of the stream
        if(SampleDecoder.validHeader(data)):
            self.fields.protocols.add("sample")
            #Create a parser if we want to parse the whole stream
            self.registerParser(SampleParser(self.fields, self.getDecoder()))

    def getDecoder(self):
        #return a decoder to decode a datastream
        return SampleDecoder()
