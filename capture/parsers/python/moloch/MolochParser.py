from .MolochHost import host

class MolochParser(object):

    def __init__(self):
        pass

    def unregister(self):
        host.moloch_parsers_unregister()

    def parse(self, data, direction):
        raise NotImplementedError("parse")
