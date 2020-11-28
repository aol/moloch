#include "python.parsers.channel.h"
#include <errno.h>

int createChannel(const char* szCommand, ChannelInfo_t* channel) {
  LOG("Create channel: %s", szCommand);
  int pipeIn[2];
  int pipeOut[2];
  int nChild;
  int nResult;

  if (pipe(pipeIn) < 0) {
    perror("allocating pipe for channel input redirect");
    return -1;
  }
  if (pipe(pipeOut) < 0) {
    close(pipeIn[PIPE_READ]);
    close(pipeIn[PIPE_WRITE]);
    perror("allocating pipe for channel output redirect");
    return -1;
  }

  nChild = fork();
  if (0 == nChild) {
    // child continues here

    // redirect stdin
    if (dup2(pipeIn[PIPE_READ], PIPEIN_FILENO) == -1) {
      exit(errno);
    }

    // redirect stdout
    if (dup2(pipeOut[PIPE_WRITE], PIPEOUT_FILENO) == -1) {
      exit(errno);
    }

    // redirect stderr
    //if (dup2(pipeOut[PIPE_WRITE], STDERR_FILENO) == -1) {
    //  exit(errno);
    //}

    // all these are for use by parent only
    close(pipeIn[PIPE_READ]);
    close(pipeIn[PIPE_WRITE]);
    close(pipeOut[PIPE_READ]);
    close(pipeOut[PIPE_WRITE]); 

    // run child process image
    // replace this with any exec* function find easier to use ("man exec")
    nResult = execl(szCommand, szCommand, (char*)NULL);

    // if we get here at all, an error occurred, but we are in the child
    // process, so just exit
    exit(nResult);
  } else if (nChild > 0) {
    // parent continues here

    // close unused file descriptors, these are for child only
    close(pipeIn[PIPE_READ]);
    close(pipeOut[PIPE_WRITE]); 

    (*channel).pid = nChild;
    (*channel).stdIn = pipeIn[PIPE_WRITE];
    (*channel).stdOut = pipeOut[PIPE_READ];

    // done with these in this example program, you would normally keep these
    // open of course as long as you want to talk to the child
    //close(pipeIn[PIPE_WRITE]);
    //close(pipeOut[PIPE_READ]);

  } else {
    // failed to create child
    close(pipeIn[PIPE_READ]);
    close(pipeIn[PIPE_WRITE]);
    close(pipeOut[PIPE_READ]);
    close(pipeOut[PIPE_WRITE]);
  }
  return nChild;
}

void writeMolochSessionObject(ChannelInfo_t* channel, MolochSession_t* session)
{  
    writeString(channel,"MolochSession", sizeof("MolochSession"));
    write(channel->stdIn, &session->addr1, sizeof(session->addr1));
    write(channel->stdIn, &session->port1, sizeof(session->port1));
    write(channel->stdIn, &session->addr2, sizeof(session->addr2));
    write(channel->stdIn, &session->port2, sizeof(session->port2));
}

void writeInt32Object(ChannelInfo_t* channel, int i)
{
    writeString(channel,"int32", sizeof("int32"));
    writeInt32(channel, i);
}

void writeStringObject(ChannelInfo_t* channel, const char *str, int len)
{
    writeString(channel,"string", sizeof("string"));
    writeString(channel, str, len);
}

void writeDataObject(ChannelInfo_t* channel, const unsigned char *str, int len)
{
    writeString(channel,"data", sizeof("data"));
    writeData(channel, str, len);
}

void assertObjectType(ChannelInfo_t* channel, const char* expected)
{
    char type[128];
    int len = readString(channel, type, sizeof(type));
    if(strcmp(type,expected)) { 
      LOG("Expected type '%s' but received type '%.*s'",expected, len, type); 
      exit(errno); 
    }
}

void readInt32Object(ChannelInfo_t* channel, int *i_out)
{
    assertObjectType(channel,"int32");
    return readInt32(channel,i_out);
}

int readStringObject(ChannelInfo_t* channel, char *str_out, int len)
{
    assertObjectType(channel,"string");
    return readString(channel,str_out,len);
}

int readDataObject(ChannelInfo_t* channel, unsigned char *data_out, int len)
{    
    assertObjectType(channel,"data");
    return readData(channel,data_out,len);
}

void writeInt32(ChannelInfo_t* channel, int i)
{
    write(channel->stdIn, &i, sizeof(int));
    //LOG("writeInt32(0x%x)", i);
}

void writeString(ChannelInfo_t* channel, const char *str, int len)
{
   return writeData(channel,(const unsigned char *)str,len);
    //LOG("WriteString(\"%.*s\")", len, str);
}

void writeData(ChannelInfo_t* channel, const unsigned char *data, int len)
{
    writeInt32(channel,len);
    write(channel->stdIn, data, len);
    //LOG("WriteData(\"%.*s\")", len, str);
}

void readInt32(ChannelInfo_t* channel, int *i_out)
{
    //LOG("ReadInt32");
    read(channel->stdOut, i_out, sizeof(int));
    //LOG("ReadInt32() = 0x%x", *i_out);
}

int readString(ChannelInfo_t* channel, char *str_out, int len)
{
    return readData(channel, (unsigned char *)str_out, len);
}

int readData(ChannelInfo_t* channel, unsigned char *data_out, int len)
{
    //LOG("ReadData");
    int length;
    readInt32(channel, &length);
    if(length > len)
    {
      LOG("Data buffer to small. Buffer length: %i. Data length: %i", len, length); 
      exit(errno);
    }
    read(channel->stdOut, data_out, length);
    //LOG("ReadData() = \"%.*s\"", length, str_out);
    return length;
}