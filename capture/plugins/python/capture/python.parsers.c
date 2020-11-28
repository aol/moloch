#include <stdbool.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <dirent.h>
#include "python.parsers.h"
#include "python.parsers.utils.h"

ChannelInfo_t processes[MOLOCH_MAX_PACKET_THREADS];


void moloch_plugin_init()
{
    LOG("ENTER moloch_plugin_init");
    gchar ** enabledPlugins = moloch_config_section_str_list(NULL, "parsers-python", "parsers", NULL);
    moloch_plugins_register("python",FALSE);

    //LOAD MODULES

    int parser_count = 0;
    char* parser_files[128];
    for (int d = 0; config.parsersDir[d]; d++)
    {
      char dirpath[PATH_MAX +1];
      realpath(config.parsersDir[d],dirpath);
      strcat(dirpath,"/python/");
      DIR *dir = opendir(dirpath);
      if(dir)
      {
        struct dirent *file;
        while((file = readdir(dir)))
        {
          if(file->d_type == DT_REG)
          {    
            if(endswith(file->d_name, ".py"))
            {              
              char* path = MOLOCH_SIZE_ALLOC("path",strlen(dirpath)+strlen(file->d_name)+1);
              *path = 0;
              strcat(path,dirpath);
              strcat(path,file->d_name);
              const char * pos = strstr(file->d_name, ".py");
              char * filename = MOLOCH_SIZE_ALLOC("filename",pos - file->d_name);
              strncpy(filename, file->d_name, pos -file->d_name);
              if(enabledPlugins)
              {
                if(g_strv_contains((const gchar* const *)enabledPlugins, "*") || 
                   g_strv_contains((const gchar* const *)enabledPlugins, filename))
                { 
                    if(!findstr(path, parser_files, parser_count))
                    {
                        python_module_init(path);                
                        parser_files[parser_count++] = path;
                    }
                    else  
                    {
                        MOLOCH_SIZE_FREE("path", path);
                    }                  
                }
              }
              MOLOCH_SIZE_FREE("filename", filename);
            }
          }
        }   
        closedir(dir);     
      }
    }
    for(int i = 0; i < parser_count; i++)
    {
      MOLOCH_SIZE_FREE("path", parser_files[i]);
    }  
    g_strfreev(enabledPlugins);
}

/******************************************************************************/

void moloch_parser_register(ModuleInfo_t *module);
void moloch_parser_define(ChannelInfo_t *channel);

void python_module_init(char *path)
{
    LOG("ENTER python_module_init(%s)", path);

    ModuleInfo_t *module = MOLOCH_TYPE_ALLOC0(ModuleInfo_t);
    module->path = MOLOCH_SIZE_ALLOC("path", strlen(path)+1);
    strcpy(module->path,path);

    ChannelInfo_t *channel = &module->channelList[0];
    if(createChannel(path,channel))
    {  
      moloch_parser_register(module);
      moloch_parser_define(channel);  
    }
    DEBUG("EXIT python_module_init(%s)", path);  
}

int dispatch_callback_register(ModuleInfo_t *module, ChannelInfo_t *channel);
void moloch_parser_register(ModuleInfo_t *module)
{
    ChannelInfo_t           *channel = &module->channelList[0];

    //Call
    writeString(channel, "moloch_parser_register", sizeof("moloch_parser_register"));
    writeInt32(channel, 0);

    //Args
    
    //Callbacks
    while(dispatch_callback_register(module, channel));  
}

int dispatch_callback_define(ChannelInfo_t *channel);
void moloch_parser_define(ChannelInfo_t *channel)
{
    DEBUG("ENTER moloch_parser_define");  

    //Call
    writeString(channel, "moloch_parser_define", sizeof("moloch_parser_define"));
    writeInt32(channel, 0); 

    //Arg

    //Callbacks
    while(dispatch_callback_define(channel));  

    DEBUG("EXIT moloch_parser_define");  
}

int dispatch_callback_classifier(ClassifierInfo_t *classifierInfo, MolochSession_t *session);
void python_classify(MolochSession_t *session, const unsigned char *data, int len, int direction, void *uw)
{    
    //LOG("ENTER python_classify");
    ClassifierInfo_t            *classifierInfo          = uw;
    ModuleInfo_t                *module                  = classifierInfo->module;
    ChannelInfo_t               *channel             = &module->channelList[session->thread];  

    if(!channel->pid)
    {
      createChannel(module->path,channel);     
      moloch_parser_define(channel);
    }

    //Call
    writeString(channel, "moloch_parser_classify", sizeof("moloch_parser_classify"));
    writeInt32(channel, 4);     
    //Args
    writeStringObject(channel, classifierInfo->name,classifierInfo->name_len);
    writeMolochSessionObject(channel, session);
    writeDataObject(channel, data, len); 
    writeInt32Object(channel, direction);

    //Callbacks
    while(dispatch_callback_classifier(classifierInfo, session));  
    //LOG("EXIT python_classify");
}

int dispatch_callback_parser(ParserInfo_t *parserInfo, MolochSession_t *session);
/******************************************************************************/
int python_parse(MolochSession_t *session, void *uw, const unsigned char *data, int len, int direction)
{
    //LOG("ENTER python_parse");
    ParserInfo_t                *parserInfo             = uw;
    ClassifierInfo_t            *classifierInfo         = parserInfo->classifierInfo; 
    ChannelInfo_t               *channel            = parserInfo->channel;  

    //Call
    writeString(channel, "moloch_parser_parse", sizeof("moloch_parser_parse"));
    writeInt32(channel, 4);     
    //Args
    writeStringObject(channel, classifierInfo->name,classifierInfo->name_len);
    writeInt32Object(channel, parserInfo->id);
    writeDataObject(channel, data, len); 
    writeInt32Object(channel, direction);

    //Callbacks
    while(dispatch_callback_parser(parserInfo, session)); 
    //LOG("EXIT python_parse"); 

    return 0;
}

/******************************************************************************/
int dispatch_callback_free(ParserInfo_t *parserInfo, MolochSession_t *session);
void python_free(MolochSession_t *session, void *uw)
{
    //LOG("ENTER python_free");
    ParserInfo_t                *parserInfo             = uw;
    ClassifierInfo_t            *classifierInfo         = parserInfo->classifierInfo; 
    ChannelInfo_t               *channel            = parserInfo->channel;  

    //Call
    writeString(channel, "moloch_parser_free", sizeof("moloch_parser_free"));
    writeInt32(channel, 2);     
    //Args
    writeStringObject(channel, classifierInfo->name,classifierInfo->name_len);
    writeInt32Object(channel, parserInfo->id);

    //Callbacks
    while(dispatch_callback_free(parserInfo, session)); 

    MOLOCH_SIZE_FREE("ParserName",parserInfo->name);
    MOLOCH_TYPE_FREE(ParserInfo_t, parserInfo);
    //LOG("EXIT python_free");
}
/******************************************************************************/

int dispatch_callback(ChannelInfo_t *channel, char* callback, int* len, int* argc)
{
    *len = readString(channel, callback, *len);
    DEBUG("dispatch_callback(%s)", callback);

    if(!strcmp(callback,"return"))
    {      
      return 0;
    }
    readInt32(channel,argc);
    if(!strcmp(callback,"LOG") && *argc == 1)
    {
      //Declare Arguments
      char logBuffer[1024];

      //Read Arguments
      int len = readStringObject(channel, logBuffer, sizeof(logBuffer));
      
      //Dispatch Call
      LOG("%s", logBuffer);
    }
    else if(!strcmp(callback,"DEBUG") && *argc == 1)
    {
      //Declare Arguments
      char logBuffer[1024];

      //Read Arguments
      int len = readStringObject(channel, logBuffer, sizeof(logBuffer));
      
      //Dispatch Call
      DEBUG("%s", logBuffer);
    }
    else
    {
      return -1;
    }
    
    return 1;
}

int dispatch_session_callback(ChannelInfo_t *channel, MolochSession_t *session, char* callback, int* len, int* argc)
{
    int result;
    if((result = dispatch_callback(channel, callback, len, argc)) < 0)
    {
        if(!strcmp(callback,"moloch_session_add_protocol") && *argc == 1)
        {
            //Declare Arguments
            char name[128];

            //Read Arguments
            int name_len = readStringObject(channel, name, sizeof(name));

            //Dispatch Call
            moloch_session_add_protocol(session, name);
        }
        else if(!strcmp(callback,"moloch_session_add_tag") && *argc == 1)
        {
            //Declare Arguments
            char name[128];

            //Read Arguments
            int name_len = readStringObject(channel, name, sizeof(name));
            
            //Dispatch Call
            moloch_session_add_tag(session, name);
        }
        else if(!strcmp(callback,"moloch_field_string_add") && *argc == 2)
        {
            //Declare Arguments
            int field;
            char value[128];

            //Read Arguments
            readInt32Object(channel, &field);
            int value_len = readStringObject(channel, value, sizeof(value));

            //Dispatch Call
            moloch_field_string_add(field,session,value,value_len, TRUE);
        }
        else if(!strcmp(callback,"moloch_field_int_add") && *argc == 2)
        {
            //Declare Arguments
            int field;
            int value;

            //Read Arguments
            readInt32Object(channel, &field);
            readInt32Object(channel, &value);

            //Dispatch Call
            moloch_field_int_add(field,session,value);
        }
        else if(!strcmp(callback,"moloch_field_ip_add_str") && *argc == 2)
        {
            //Declare Arguments
            int field;
            char value[128];

            //Read Arguments
            readInt32Object(channel, &field);
            int value_len = readStringObject(channel, value, sizeof(value));

            //Dispatch Call
            moloch_field_ip_add_str(field,session,value);
        }
        else
        {
            return result;
        }
        result = 1;
    }
    return result;
}

int dispatch_callback_register(ModuleInfo_t *module, ChannelInfo_t *channel)
{
    char callback[1024];
    int callback_len = sizeof(callback);
    int argc = 0;

    int result;
    if((result = dispatch_callback(channel, callback, &callback_len, &argc)) < 0)
    {
        if(!strncmp(callback,"moloch_parsers_classifier_register", sizeof("moloch_parsers_classifier_register")-1) && argc == 3)
        {
            //Declare Arguments
            char name[128];
            int offset;
            unsigned char match[128];

            //Read Arguments
            int name_len = readStringObject(channel, name, sizeof(name));
            readInt32Object(channel, &offset);
            int match_len = readDataObject(channel, match, sizeof(match));

            //Dispatch Call
            char* name_ptr = MOLOCH_SIZE_ALLOC("ClassifierName", name_len);
            strncpy(name_ptr, name, name_len);

            unsigned char* match_ptr = MOLOCH_SIZE_ALLOC("ClassifierMatch", match_len);            
            memcpy(match_ptr, match, match_len);

            ClassifierInfo_t           *classifierInfo = MOLOCH_TYPE_ALLOC0(ClassifierInfo_t);
            classifierInfo->name = name_ptr;
            classifierInfo->name_len = name_len;
            classifierInfo->module = module;

            if(!strcmp(callback,"moloch_parsers_classifier_register_tcp"))
            {
                moloch_parsers_classifier_register_tcp(name_ptr, classifierInfo, offset, match_ptr, match_len, python_classify);
            }
            else if(!strcmp(callback,"moloch_parsers_classifier_register_udp"))
            {
                moloch_parsers_classifier_register_udp(name_ptr, classifierInfo, offset, match_ptr, match_len, python_classify);
            }
            else
            {
              LOG("Unknown callback: %.*s", callback_len, callback);
              exit(result);
            }            
        }
        else
        {
            LOG("Unknown callback: %.*s", callback_len, callback);
            exit(result);
        }
        result = 1;
    }
    return result;
}

char* defined_fields[1024];
int moloch_field_get_or_define(char *group, char *kind, char *expression, char *friendlyName, char *dbField, char *help, int type, int flags)
{
    int defined_fields_length = (sizeof(defined_fields)/sizeof(char*));
    int i;
    for(i = 0; defined_fields[i] && i < defined_fields_length; i++)
    {
        if(!strcmp(defined_fields[i], dbField))
        {
            break;
        }
    }
    
    int result;
    if(defined_fields[i])
    {
        result = moloch_field_by_db(dbField);
    }
    else
    {
        result = moloch_field_define(group,kind,expression,friendlyName,dbField,help,type,flags,(char *)NULL);
        defined_fields[i] = MOLOCH_SIZE_ALLOC("defined_field", strlen(dbField));
        strcpy(defined_fields[i],dbField);
    }
    
    return result;
}


int dispatch_callback_define(ChannelInfo_t *channel)
{
    char callback[1024];
    int callback_len = sizeof(callback);
    int argc = 0;

    int result;
    if((result = dispatch_callback(channel, callback, &callback_len, &argc)) < 0)
    {
        if(!strcmp(callback,"moloch_field_define") && argc == 8)
        {
            //Declare Arguments
            char group[128];
            char kind[128];
            char expression[128];
            char friendlyName[128];
            char dbField[128];
            char help[128];
            int type;
            int flags;

            //Read Arguments
            readStringObject(channel, group, sizeof(group));
            readStringObject(channel, kind, sizeof(kind));
            readStringObject(channel, expression, sizeof(expression));
            readStringObject(channel, friendlyName, sizeof(friendlyName));
            readStringObject(channel, dbField, sizeof(dbField));
            readStringObject(channel, help, sizeof(help));
            readInt32Object(channel, &type);
            readInt32Object(channel, &flags);
  
            //Dispatch Call
            int result = moloch_field_get_or_define(group,kind,expression,friendlyName,dbField,help,type,flags);
  
            //Return result
            writeInt32(channel,result);
        }
        else
        {
            LOG("Unknown callback: %.*s", callback_len, callback);
            exit(result);
        }
        result = 1;
    }
    return result;
}

int dispatch_callback_classifier(ClassifierInfo_t *classifierInfo, MolochSession_t *session)
{
    ChannelInfo_t               *channel             = &classifierInfo->module->channelList[session->thread]; 

    char callback[1024];
    int callback_len = sizeof(callback);
    int argc = 0;

    int result;
    if((result = dispatch_session_callback(channel, session, callback, &callback_len, &argc)) < 0)
    {
        if(!strcmp(callback,"moloch_parsers_register") && argc == 1)
        {
            //Declare Arguments
            char name[128];

            //Read Arguments
            int name_len = readStringObject(channel, name, sizeof(name));

            //Dispatch Call
            char* name_ptr = MOLOCH_SIZE_ALLOC("ParserName", name_len);
            strncpy(name_ptr, name, name_len);

            ParserInfo_t *parserInfo = MOLOCH_TYPE_ALLOC0(ParserInfo_t);
            parserInfo->id = ++parserId;
            parserInfo->name = name_ptr;
            parserInfo->name_len = name_len;
            parserInfo->classifierInfo = classifierInfo;
            parserInfo->channel = channel;
            moloch_parsers_register(session, python_parse, parserInfo, python_free);

            //Return
            writeInt32(channel, parserInfo->id);
        }
        else
        {
            LOG("Unknown callback: %.*s", callback_len, callback);
            exit(result);
        }
        result = 1;
    }
    return result;
}

int dispatch_callback_parser(ParserInfo_t *parserInfo, MolochSession_t *session)
{
    ChannelInfo_t               *channel             = parserInfo->channel; 

    char callback[1024];
    int callback_len = sizeof(callback);
    int argc = 0;

    int result;
    if((result = dispatch_session_callback(channel, session, callback, &callback_len, &argc)) < 0)
    {       
        if(!strcmp(callback,"moloch_parsers_unregister") && argc == 0)
        {
            moloch_parsers_unregister(session, parserInfo);
        }
        else
        {
            LOG("Unknown callback: %.*s", callback_len, callback);
            exit(result);
        }
        result = 1;
    }
    return result;
}

int dispatch_callback_free(ParserInfo_t *parserInfo, MolochSession_t *session)
{
    ChannelInfo_t               *channel             = parserInfo->channel; 

    char callback[1024];
    int callback_len = sizeof(callback);
    int argc = 0;

    int result;
    if((result = dispatch_callback(channel, callback, &callback_len, &argc)) < 0)
    {       
        {
            LOG("Unknown callback: %.*s", callback_len, callback);
            exit(result);
        }
        result = 1;
    }
    return result;
} 