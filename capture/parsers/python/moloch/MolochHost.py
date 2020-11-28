import sys
from .MolochChannel import MolochChannel

class Host(object):
    def __init__(self, channel):
        self._channel = channel

    def _call(self, name, cargs):
        self._channel.writeCString(name)
        self._channel.writeInt32(cargs)

    def host_callback_begin(self):
        callback = self._channel.readCString()
        argc = self._channel.readInt32()
        
        args = []
        for _ in range(argc):
            args += [self._channel.readObject()]
        
        return (callback, args)

    def host_callback_end(self, result):
        self._channel.writeCString("return")
        if(result != None):
            self._channel.writeObject(result)
        self._channel.flush()

class MolochCaptureHost(Host): 

    def LOG(self,str):
        self._call('LOG',1)

        self._channel.writeCStringObject(str)

        self._channel.flush()

    def DEBUG(self,str):
        self._call('DEBUG',1)

        self._channel.writeCStringObject(str)

        self._channel.flush()

    #register classifier
    def moloch_parsers_classifier_register_tcp(self, name, offset, match):
        self._call('moloch_parsers_classifier_register_tcp',3)
        
        self._channel.writeCStringObject(name)
        self._channel.writeInt32Object(offset)
        self._channel.writeDataObject(match)

        self._channel.flush()

    def moloch_parsers_classifier_register_udp(self, name, offset, match):
        self._call('moloch_parsers_classifier_register_udp',3)
        
        self._channel.writeCStringObject(name)
        self._channel.writeInt32Object(offset)
        self._channel.writeDataObject(match)

        self._channel.flush()

    #register parser
    def moloch_parsers_register(self, name): 
        self._call('moloch_parsers_register',1)
        
        self._channel.writeCStringObject(name)

        self._channel.flush()

        return self._channel.readInt32()

    #register parser
    def moloch_parsers_unregister(self): 
        self._call('moloch_parsers_unregister', 0)

        self._channel.flush()

    #add protocol to session
    def moloch_session_add_protocol(self, name): 
        self._call('moloch_session_add_protocol',1)
        
        self._channel.writeCStringObject(name)

        self._channel.flush()

    #add protocol to session
    def moloch_session_add_tag(self, name): 
        self._call('moloch_session_add_tag',1)
        
        self._channel.writeCStringObject(name)

        self._channel.flush()

    #define field
    def moloch_field_define(self, group, kind, expression, friendlyName, dbField, help, type, flags): 
        self._call('moloch_field_define',8)
        
        self._channel.writeCStringObject(group)
        self._channel.writeCStringObject(kind)
        self._channel.writeCStringObject(expression)
        self._channel.writeCStringObject(friendlyName)
        self._channel.writeCStringObject(dbField)
        self._channel.writeCStringObject(help)
        self._channel.writeInt32Object(type)
        self._channel.writeInt32Object(flags)

        self._channel.flush()

        return self._channel.readInt32()

    #add string field
    def moloch_field_string_add(self, field, value): 
        self._call('moloch_field_string_add',2)
        
        self._channel.writeInt32Object(field)
        self._channel.writeCStringObject(value)

        self._channel.flush()

    def moloch_field_int_add(self, field, value): 
        self._call('moloch_field_int_add',2)
        
        self._channel.writeInt32Object(field)
        self._channel.writeInt32Object(value)

        self._channel.flush()

    def moloch_field_ip_add_str(self, field, value): 
        self._call('moloch_field_ip_add_str',2)
        
        self._channel.writeInt32Object(field)
        self._channel.writeCStringObject(value)

        self._channel.flush()

class MolochViewerHost(Host):
    def toHtml(self, data):
        self._call('viewer_toHtml',1)
        
        self._channel.writeDataObject(data)

        self._channel.flush()

        return self._channel.readCString()

MolochChannel.debug()
channel = MolochChannel()
host = MolochCaptureHost(channel)
viewer = MolochViewerHost(channel)