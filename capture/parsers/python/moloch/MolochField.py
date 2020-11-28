from .MolochHost import host

class MolochField(object):

    class FIELDS():
        Protocols = -1
        Tags = -2

    class FLAGS():
        Linked_Sessions = 0x0001    #Field should be set on all linked sessions
        Force_Utf8 = 0x0004         #Force the field to be utf8
        NoDb = 0x0008               #Don't create in fields db table
        Fake = 0x0010               #Don't create in capture list
        Disabled = 0x0020           #Don't create in capture list
        Cnt = 0x1000                #Added Cnt
        IpPre = 0x4000              #prepend ip stuff

    class KIND():
        Ip = "ip"
        LoTextfield = "lotextfield" #lower case tokenized string
        Textfield = "textfield"     #tokenized s
        LoTermfield = "lotermfield" #lower case non tokenized string
        Termfield = "termfield"     #non tokenized string
        Uptermfield = "uptermfield" #upper case non tokenized s
        Integer = "integer"

    class TYPE():
        Int = 0
        Int_Array = 1
        Int_Hash = 2
        Int_GHash = 3

        String = 4
        String_Array = 5
        String_Hash = 6
        String_GHash = 7

        Ip = 8
        Ip_GHash = 9

        Cert_Info = 10  
    
    def __init__(self, id, type):
        self.id = id
        self.type = type

    def add(self,value):
        if(self.id == MolochField.FIELDS.Protocols):        
            host.moloch_session_add_protocol(value)        
        elif(self.id == MolochField.FIELDS.Tags):      
            host.moloch_session_add_tag(value)
        else:    
            if(self.type == MolochField.TYPE.String or
                self.type == MolochField.TYPE.String_Array or
                self.type == MolochField.TYPE.String_Hash or
                self.type == MolochField.TYPE.String_GHash):    
                host.moloch_field_string_add(self.id, value)
            elif(self.type == MolochField.TYPE.Int or
                self.type == MolochField.TYPE.Int_Array or
                self.type == MolochField.TYPE.Int_Hash or
                self.type == MolochField.TYPE.Int_GHash):    
                host.moloch_field_int_add(self.id, value)      
            elif(self.type == MolochField.TYPE.Ip or
                self.type == MolochField.TYPE.Ip_GHash):    
                host.moloch_field_ip_add_str(self.id, value)    
                