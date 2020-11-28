#include "python.parsers.channel.h"

typedef struct {
    char* path;
    ChannelInfo_t channelList[MOLOCH_MAX_PACKET_THREADS];
} ModuleInfo_t;

typedef struct {
    char* name;
    int name_len;
    ModuleInfo_t* module;
} ClassifierInfo_t;

int parserId = 0;
typedef struct {
    int id;
    char* name;
    int name_len;
    ChannelInfo_t* channel;
    ClassifierInfo_t* classifierInfo;
} ParserInfo_t;


void moloch_plugin_init();
void python_module_init(char *path);