#include "python.parsers.utils.h"
#include <string.h>

char* findstr(char* needle, char** haystack, int size)
{
  for(int i = 0; i < size; i++)
  {
    if(!strcmp(haystack[i],needle))
    {
      return haystack[i];
    }
  }
  return NULL;
}

bool endswith(const char* str,const  char* ending)
{
    const char* str_ending = str + strlen(str) - strlen(ending);
    return !strcmp(str_ending, ending);
}