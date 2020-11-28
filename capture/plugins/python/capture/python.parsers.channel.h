#include "python.parsers.moloch.h"

#define PIPE_READ 0
#define PIPE_WRITE 1

#define PIPEIN_FILENO 3
#define PIPEOUT_FILENO 4

typedef struct {
    int pid;
    int stdIn;
    int stdOut;
} ChannelInfo_t;

int createChannel(const char* szCommand, ChannelInfo_t* channel);

void writeMolochSessionObject(ChannelInfo_t* channel, MolochSession_t* session);
void writeInt32Object(ChannelInfo_t* channel, int i);
void writeStringObject(ChannelInfo_t* channel, const char *str, int len);
void writeDataObject(ChannelInfo_t* channel, const unsigned char *str, int len);

void readInt32Object(ChannelInfo_t* channel, int *i_out);
int readStringObject(ChannelInfo_t* channel, char *str_out, int len);
int readDataObject(ChannelInfo_t* channel, unsigned char *data_out, int len);

void writeInt32(ChannelInfo_t* channel, int i);
void writeString(ChannelInfo_t* channel, const char *str, int len);
void writeData(ChannelInfo_t* channel, const unsigned char *data, int len);

void readInt32(ChannelInfo_t* channel, int *i_out);
int readString(ChannelInfo_t* channel, char *str_out, int len);
int readData(ChannelInfo_t* channel, unsigned char *data_out, int len);