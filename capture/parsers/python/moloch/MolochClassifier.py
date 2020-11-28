from .MolochHost import host
from .MolochField import MolochField

class MolochClassifier(object):
    class _Fields():

        def __init__(self):
            self.protocols = MolochField(MolochField.FIELDS.Protocols, None)
            self.tags = MolochField(MolochField.FIELDS.Tags, None)     
    
    def __init__(self, offset = 0, match = bytes()):
        self.offset = offset
        self.match = match
        self.parsers = dict()
        self.fields = MolochClassifier._Fields()

    def registerParser(self, parser):
        parserId = host.moloch_parsers_register(parser.__class__.__name__)
        self.parsers[parserId] = parser
        
    def defineField(self, group, kind, expression, friendlyName, dbField, help, type, flags):
        fieldId = host.moloch_field_define(group,kind,expression,friendlyName,dbField,help,type,flags)
        return MolochField(fieldId, type)

    def define(self):
        pass

    def classify(self, session, data, direction):
        raise NotImplementedError("classify")

    def getDecoder(self):
        raise NotImplementedError("decoder")

class MolochTcpClassifier(MolochClassifier):
    pass

class MolochUdpClassifier(MolochClassifier):
    pass