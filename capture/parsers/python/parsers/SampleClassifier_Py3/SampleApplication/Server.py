from pwn import *
import struct

masterkey = 0xdeadbeaf

def cb(conn):
    conn = remote.fromsocket(conn.sock)
    (checksum,master,session) = struct.unpack("!III",conn.read(12))
    #handshake
    if(master^masterkey == checksum):
        sessionkey = session^masterkey
    
        while True:        
            cmd = cmd_input()
            writecmd(conn, sessionkey, cmd)
            (resp_cmd, resp_val) = readcmd(conn,sessionkey)
            if(len(resp_val) > 10000):
                print 'len(response) = %s' % len(resp_val)
            else:
                print resp_val

def cmd_input():
    while True: 
        cmd = raw_input('cmd: ').rstrip()
        if(cmd in ['hello','version','passwd','screen', 'ping']):
            return cmd
        print 'Invalid command.\nAllowed commands: ping, hello, version, passwd, screen'

def writecmd(conn, key, data):
    conn.p32(len(data) ^ key)
    conn.write(xor(data,struct.pack("I",key)))

def readcmd(conn, key):
    l = conn.u32() ^ key
    cmd = xor(conn.readn(l),struct.pack("I",key))
    
    return (cmd[0:16].rstrip(),cmd[16:])

s = server(9999,callback=cb)

s.wait_for_close()
