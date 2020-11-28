from .MolochHost import host
from .MolochClassifier import *
from .MolochTypes import IDataFrame

class MolochPlugin(object):
    class _moloch_instance():
        def __init__(self, plugin):
            self.plugin = plugin
            self.classifiers = None
        
        def moloch_parser_register(self):
            self.plugin._moloch_register()
            pass

        def moloch_parser_define(self):
            self.plugin._moloch_define()
            pass

        def moloch_parser_classify(self, classifierName, session, data, direction): 
            self.plugin._moloch_classify(classifierName, session, data, direction)
            pass

        def moloch_parser_parse(self, name, parserId, data, direction):  
            self.plugin._moloch_parse(name,parserId,data,direction)
            pass

        def moloch_parser_free(self, name, parserId):  
            self.plugin._moloch_free(name,parserId)
            pass
        
        def moloch_decoder_decode(self, name, data, direction, decoder=None):
            frame = self.plugin._decoder_decode(name, data, direction, decoder)
            if frame is None:
                return IDataFrame(bytes(), 'No frame')
            else:
                return IDataFrame(frame.data(), frame.html())
                    
        def dispatch_callback(self):
            try:
                (callback, args) = host.host_callback_begin()                
                result = getattr(self,callback)(*args)
                host.host_callback_end(result)
                return True
            except EOFError:
                return False            

    def __init__(self, classifiers):
        self.__moloch_instance = MolochPlugin._moloch_instance(self)
        self.classifiers = dict([(c.__class__.__name__, c) for c in classifiers])
        self.decoders = dict([(c.__class__.__name__, None) for c in classifiers])

    def start(self):
        while(self.__moloch_instance.dispatch_callback()):
            pass

    def profile(self):
        import cProfile

        pr = cProfile.Profile()
        pr.enable()

        self.start()
        
        pr.disable()
        pr.print_stats()

    def _moloch_register(self):
        for (name, classifier) in self.classifiers.items():  
            if(isinstance(classifier, MolochTcpClassifier)):
                host.moloch_parsers_classifier_register_tcp(name, classifier.offset, classifier.match)
            elif(isinstance(classifier, MolochUdpClassifier)):
                host.moloch_parsers_classifier_register_udp(name, classifier.offset, classifier.match)
            else:
                raise Exception("Unknown classifier type.")

    def _moloch_define(self):
        for classifier in self.classifiers.values():        
            classifier.define()

    def _moloch_classify(self, name, session, data, direction):
        classifier = self.classifiers[name]
        classifier.classify(session, data, direction)

    def _moloch_parse(self, name, parserId, data, direction):
        classifier = self.classifiers[name]
        parser = classifier.parsers[parserId]
        parser.parse(data, direction)

    def _moloch_free(self, name, parserId):
        classifier = self.classifiers[name]
        del classifier.parsers[parserId]

    def _decoder_decode(self, name, data, direction, decoder_name):
        decoder = self.decoders[name]
        if decoder is None:
            if decoder_name == 'undefined':
                # added for backward compatibility
                # (i.e., if getDecoder doesn't accept an argument)
                decoder = self.classifiers[name].getDecoder()
            else:
                decoder = self.classifiers[name].getDecoder(decoder_name)

            self.decoders[name] = decoder

        return decoder.decode(data,direction)
