#include "moloch.h"

extern MolochConfig_t        config;

#define DEBUG(...) do { \
  if(config.debug == TRUE) { \
    LOG(__VA_ARGS__); \
  } \
} while(0) /* no trailing; */
