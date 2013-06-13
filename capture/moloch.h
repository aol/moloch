/******************************************************************************/
/* moloch.h -- General Moloch include file
 *
 * Copyright 2012-2013 AOL Inc. All rights reserved.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this Software except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/tcp.h>
#include <netinet/udp.h>
#include "http_parser.h"
#include "dll.h"
#include "hash.h"
#include "nids.h"
#include "glib.h"

#define UNUSED(x) x __attribute((unused))


#define MOLOCH_API_VERSION 3

/******************************************************************************/
/*
 * Base Hash Table Types
 */
typedef struct moloch_int {
    struct moloch_int    *i_next, *i_prev;
    uint32_t              i_hash;
    short                 i_bucket;
} MolochInt_t;

typedef struct {
    struct moloch_int *i_next, *i_prev;
    int i_count;
} MolochIntHead_t;

typedef HASH_VAR(s_, MolochIntHash_t, MolochIntHead_t, 1);
typedef HASH_VAR(s_, MolochIntHashStd_t, MolochIntHead_t, 13);

typedef struct moloch_string {
    struct moloch_string *s_next, *s_prev;
    char                 *str;
    uint32_t              s_hash;
    short                 s_bucket;
    short                 len:15;
    short                 utf8:1;
} MolochString_t;

typedef struct {
    struct moloch_string *s_next, *s_prev;
    int s_count;
} MolochStringHead_t;
typedef HASH_VAR(s_, MolochStringHash_t, MolochStringHead_t, 1);
typedef HASH_VAR(s_, MolochStringHashStd_t, MolochStringHead_t, 13);


/******************************************************************************/
/*
 * Information about the various fields that we capture
 */

#define MOLOCH_FIELD_TYPE_INT        0
#define MOLOCH_FIELD_TYPE_INT_ARRAY  1
#define MOLOCH_FIELD_TYPE_INT_HASH   2
#define MOLOCH_FIELD_TYPE_STR        3
#define MOLOCH_FIELD_TYPE_STR_ARRAY  4
#define MOLOCH_FIELD_TYPE_STR_HASH   5
#define MOLOCH_FIELD_TYPE_IP_HASH    6

#define MOLOCH_FIELD_FLAG_CNT         0x0001
#define MOLOCH_FIELD_FLAG_SCNT        0x0002
#define MOLOCH_FIELD_FLAG_FORCE_UTF8  0x0004
#define MOLOCH_FIELD_FLAG_HEADERS     0x0008

typedef struct {
    char                 *name;
    int                   len;
    int                   pos;
    uint16_t              type;
    uint16_t              flags;
} MolochFieldInfo_t;

typedef union {
    char                  *str;
    GPtrArray             *sarray;
    MolochStringHashStd_t *shash;
    int                    i;
    GArray                *iarray;
    MolochIntHashStd_t    *ihash;
} MolochField_t;

/******************************************************************************/
/*
 * Configuration Information
 */
enum MolochRotate { MOLOCH_ROTATE_DAILY, MOLOCH_ROTATE_WEEKLY, MOLOCH_ROTATE_MONTHLY };
typedef struct moloch_config {
    char     *configFile;
    char     *nodeName;
    char     *hostName;
    char     *pcapReadFile;
    char     *pcapReadDir;
    gboolean  debug;
    gboolean  dryRun;
    gboolean  fakePcap;
    gboolean  copyPcap;
    gboolean  pcapRecursive;

    enum MolochRotate rotate;

    HASH_VAR(s_, dontSaveTags, MolochStringHead_t, 11);
    MolochFieldInfo_t *fields[100];
    int                maxField;

    char     *nodeClass;
    char     *elasticsearch;
    char     *interface;
    char     *pcapDir;
    char     *bpf;
    char     *yara;
    char     *emailYara;
    char     *geoipFile;
    char     *geoipASNFile;
    char     *dropUser;
    char     *dropGroup;
    char     *pluginsDir;

    char     **plugins;
    char     **smtpIpHeaders;

    uint32_t  maxFileSizeG;
    uint32_t  minFreeSpaceG;
    uint32_t  icmpTimeout;
    uint32_t  udpTimeout;
    uint32_t  tcpTimeout;
    uint32_t  tcpSaveTimeout;
    uint32_t  maxStreams;
    uint32_t  maxPackets;
    uint32_t  dbBulkSize;
    uint32_t  maxESConns;
    uint32_t  maxESRequests;
    uint32_t  logEveryXPackets;
    uint32_t  packetsPerPoll;
    uint32_t  pcapBufferSize;
    uint32_t  pcapWriteSize;

    char      logUnknownProtocols;
    char      logESRequests;
    char      logFileCreation;
    char      parseSMTP;
} MolochConfig_t;

typedef struct {
    char     *country;
    char     *asn;
    int       numtags;
    int       tags[10];
} MolochIpInfo_t;

/******************************************************************************/
/*
 * SPI Data Storage
 */

typedef struct {
    MolochStringHead_t  commonName; //2.5.4.3
    char               *orgName; // 2.5.4.10
    char                orgUtf8;
} MolochCertInfo_t;

typedef struct moloch_tlsinfo{
    struct moloch_tlsinfo *t_next, *t_prev;
    uint32_t               t_hash;
    MolochCertInfo_t       issuer;
    MolochCertInfo_t       subject;
    MolochStringHead_t     alt;
    unsigned char         *serialNumber;
    short                  serialNumberLen;
    short                  t_bucket;
} MolochCertsInfo_t;

typedef struct {
    struct moloch_tlsinfo *t_next, *t_prev;
    int                    t_count;
} MolochCertsInfoHead_t;


#define MOLOCH_MAX_PLUGINS       10

typedef struct moloch_session_email {
    MolochStringHead_t boundaries;
    char               state[2];
    GString           *line[2];
    gint               state64[2];
    guint              save64[2];
    GChecksum         *checksum[2];

    uint16_t           base64Decode:2;
} MolochSessionEmail_t;

typedef struct moloch_session_http {
    GString    *urlString;
    GString    *hostString;

    GString    *valueString[2];

    char        header[2][40];
    short       pos[2];
    http_parser parsers[2];

    GChecksum  *checksum[2];

    uint16_t    wParsers:2;
    uint16_t    inHeader:2;
    uint16_t    inValue:2;
    uint16_t    inBody:2;
} MolochSessionHttp_t;

typedef struct moloch_session {
    struct moloch_session *tcp_next, *tcp_prev;
    struct moloch_session *q_next, *q_prev;
    struct moloch_session *h_next, *h_prev;
    int                    h_bucket;
    uint32_t               h_hash;


    HASH_VAR(t_, certs, MolochCertsInfoHead_t, 5);

    MolochField_t        **fields;
    MolochSessionHttp_t   *http;
    MolochSessionEmail_t  *email;

    void       *pluginData[MOLOCH_MAX_PLUGINS];


    GArray     *filePosArray;
    GArray     *fileNumArray;
    char       *rootId;

    struct timeval firstPacket;
    struct timeval lastPacket;

    uint64_t    bytes;
    uint64_t    databytes;


    uint32_t    jsonSize;
    uint32_t    lastSave;
    uint32_t    addr1;
    uint32_t    addr2;
    uint32_t    packets;

    uint16_t    port1;
    uint16_t    port2;
    uint16_t    protocol;
    uint16_t    offsets[2];
    uint16_t    outstandingQueries;
    uint16_t    sshLen;

    uint8_t     ip_tos;
    uint8_t     tcp_flags;
    uint8_t     sshCode;

    uint16_t    haveNidsTcp:1;
    uint16_t    needSave:1;
    uint16_t    dontSave:1;
    uint16_t    which:1;
    uint16_t    isSsh:1;
} MolochSession_t;

typedef struct moloch_session_head {
    struct moloch_session *tcp_next, *tcp_prev;
    struct moloch_session *q_next, *q_prev;
    struct moloch_session *h_next, *h_prev;
    int                    h_bucket;
    int                    tcp_count;
    int                    q_count;
    int                    h_count;
} MolochSessionHead_t;


#define MOLOCH_TYPE_ALLOC(type) (type *)(g_slice_alloc(sizeof(type)))
#define MOLOCH_TYPE_ALLOC0(type) (type *)(g_slice_alloc0(sizeof(type)))
#define MOLOCH_TYPE_FREE(type,mem) g_slice_free1(sizeof(type),mem)

void *moloch_size_alloc(int size, int zero);
int   moloch_size_free(void *mem);
#define MOLOCH_SIZE_ALLOC(name, s)  moloch_size_alloc(s, 0)
#define MOLOCH_SIZE_ALLOC0(name, s) moloch_size_alloc(s, 1)
#define MOLOCH_SIZE_FREE(name, mem) moloch_size_free(mem)


/******************************************************************************/
/*
 * Callback function definitions
 */
typedef int (*MolochWatchFd_func)(gint fd, GIOCondition cond, gpointer data);

typedef void (*MolochResponse_cb)(unsigned char *data, int len, gpointer uw);

typedef void (*MolochTag_cb)(void *uw, int tagtype, uint32_t tag);

typedef void (*MolochSeqNum_cb)(uint32_t seq, gpointer uw);

/******************************************************************************/
#define LOG(...) do { \
    time_t t = time(NULL); \
    printf("%15.15s %s:%d %s(): ",\
        ctime(&t)+4, __FILE__,\
        __LINE__, __FUNCTION__); \
    printf(__VA_ARGS__); \
    printf("\n"); \
} while(0) /* no trailing ; */


/******************************************************************************/
/*
 * main.c
 */

#define MOLOCH_GIO_READ_COND  (G_IO_IN | G_IO_HUP | G_IO_ERR | G_IO_NVAL)
#define MOLOCH_GIO_WRITE_COND (G_IO_OUT | G_IO_HUP | G_IO_ERR | G_IO_NVAL)

gint moloch_watch_fd(gint fd, GIOCondition cond, MolochWatchFd_func func, gpointer data);
unsigned char *moloch_js0n_get(unsigned char *data, uint32_t len, char *key, uint32_t *olen);
char *moloch_js0n_get_str(unsigned char *data, uint32_t len, char *key);

gboolean moloch_string_add(void *hash, char *string, gboolean copy);

uint32_t moloch_string_hash(const void *key);
int moloch_string_cmp(const void *keyv, const void *elementv);


uint32_t moloch_int_hash(const void *key);
int moloch_int_cmp(const void *keyv, const void *elementv);

void moloch_quit();


/******************************************************************************/
/*
 * config.c
 */
void moloch_config_init();
void moloch_config_load_local_ips();
void moloch_config_load_headers();
void moloch_config_exit();

gchar *moloch_config_str(GKeyFile *keyfile, char *key, char *d);
gchar **moloch_config_str_list(GKeyFile *keyfile, char *key, char *d);
uint32_t moloch_config_int(GKeyFile *keyfile, char *key, uint32_t d, uint32_t min, uint32_t max);
char moloch_config_boolean(GKeyFile *keyfile, char *key, char d);
void moloch_db_add_local_ip(char *str, MolochIpInfo_t *ii);



/******************************************************************************/
/*
 * db.c
 */

void  moloch_db_init();
int   moloch_db_tags_loading();
char *moloch_db_create_file(time_t firstPacket, char *name, uint64_t size, uint32_t *id);
void  moloch_db_save_session(MolochSession_t *session, int final);
void  moloch_db_get_tag(void *uw, int tagtype, const char *tag, MolochTag_cb func);
void  moloch_db_exit();

/******************************************************************************/
/*
 * detect.c
 */
void moloch_detect_init();
void moloch_detect_initial_tag(MolochSession_t *session);
void moloch_detect_parse_classify(MolochSession_t *session, struct tcp_stream *UNUSED(a_tcp), struct half_stream *hlf);
void moloch_detect_parse_http(MolochSession_t *session, struct tcp_stream *UNUSED(a_tcp), struct half_stream *hlf);
void moloch_detect_parse_email(MolochSession_t *session, struct tcp_stream *UNUSED(a_tcp), struct half_stream *hlf);
void moloch_detect_parse_ssh(MolochSession_t *session, struct tcp_stream *UNUSED(a_tcp), struct half_stream *hlf);
void moloch_detect_parse_yara(MolochSession_t *session, struct tcp_stream *UNUSED(a_tcp), struct half_stream *hlf);
void moloch_detect_dns(MolochSession_t *session, unsigned char *data, int len);
void moloch_detect_exit();

/******************************************************************************/
/*
 * http.c
 */


#define MOLOCH_HTTP_BUFFER_SIZE 10000

void moloch_http_init();

unsigned char *moloch_http_send_sync(void *serverV, char *method, char *key, uint32_t key_len, char *data, uint32_t data_len, size_t *return_len);
gboolean moloch_http_send(void *serverV, char *method, char *key, uint32_t key_len, char *data, uint32_t data_len, gboolean dropable, MolochResponse_cb func, gpointer uw);


gboolean moloch_http_set(void *server, char *key, int key_len, char *data, uint32_t data_len, MolochResponse_cb func, gpointer uw);
unsigned char *moloch_http_get(void *server, char *key, int key_len, size_t *mlen);
#define moloch_http_get_buffer(s) MOLOCH_SIZE_ALLOC(buffer, s)
void moloch_http_exit();
int moloch_http_queue_length(void *server);

void *moloch_http_create_server(char *hostname, int defaultPort, int maxConns, int maxOutstandingRequests);
void moloch_http_free_server(void *serverV);

/******************************************************************************/
/*
 * nids.c
 */

void  moloch_nids_root_init();
void  moloch_nids_init();
void  moloch_nids_add_tag(MolochSession_t *session, int tagtype, const char *tag);
void  moloch_nids_certs_free (MolochCertsInfo_t *certs);
uint32_t moloch_nids_dropped_packets();
uint32_t moloch_nids_monitoring_sessions();
void  moloch_nids_exit();

void moloch_nids_incr_outstanding(MolochSession_t *session);
void moloch_nids_decr_outstanding(MolochSession_t *session);

void moloch_nids_new_session_http(MolochSession_t *session);
void moloch_nids_free_session_http(MolochSession_t *session);

void moloch_nids_new_session_email(MolochSession_t *session);
void moloch_nids_free_session_email(MolochSession_t *session);

/******************************************************************************/
/*
 * plugins.c
 */
typedef void (* MolochPluginInitFunc) ();
typedef void (* MolochPluginIpFunc) (MolochSession_t *session, struct ip *packet, int len);
typedef void (* MolochPluginUdpFunc) (MolochSession_t *session, struct udphdr *udphdr, unsigned char *data, int len);
typedef void (* MolochPluginTcpFunc) (MolochSession_t *session, struct tcp_stream *a_tcp);
typedef void (* MolochPluginSaveFunc) (MolochSession_t *session, int final);
typedef void (* MolochPluginNewFunc) (MolochSession_t *session);
typedef void (* MolochPluginExitFunc) ();
typedef void (* MolochPluginReloadFunc) ();

typedef void (* MolochPluginHttpDataFunc) (MolochSession_t *session, http_parser *hp, const char *at, size_t length);
typedef void (* MolochPluginHttpFunc) (MolochSession_t *session, http_parser *hp);

typedef void (* MolochPluginSMTPHeaderFunc) (MolochSession_t *session, const char *field, size_t field_len, const char *value, size_t value_len);
typedef void (* MolochPluginSMTPFunc) (MolochSession_t *session);

#define MOLOCH_PLUGIN_SAVE         0x00000001
#define MOLOCH_PLUGIN_IP           0x00000002
#define MOLOCH_PLUGIN_UDP          0x00000004
#define MOLOCH_PLUGIN_TCP          0x00000008
#define MOLOCH_PLUGIN_EXIT         0x00000010
#define MOLOCH_PLUGIN_NEW          0x00000020
#define MOLOCH_PLUGIN_RELOAD       0x00000040

#define MOLOCH_PLUGIN_HP_OMB       0x00001000
#define MOLOCH_PLUGIN_HP_OU        0x00002000
#define MOLOCH_PLUGIN_HP_OHF       0x00004000
#define MOLOCH_PLUGIN_HP_OHV       0x00008000
#define MOLOCH_PLUGIN_HP_OHC       0x00010000
#define MOLOCH_PLUGIN_HP_OB        0x00020000
#define MOLOCH_PLUGIN_HP_OMC       0x00040000

#define MOLOCH_PLUGIN_SMTP_OH      0x00100000
#define MOLOCH_PLUGIN_SMTP_OHC     0x00200000

void moloch_plugins_init();
void moloch_plugins_reload();

int  moloch_plugins_register_internal(const char *name, gboolean storeData, size_t sessionsize, int apiversion);
#define moloch_plugins_register(name, storeData) moloch_plugins_register_internal(name, storeData, sizeof(MolochSession_t), MOLOCH_API_VERSION)

void moloch_plugins_set_cb(const char *            name,
                           MolochPluginIpFunc      ipFunc,
                           MolochPluginUdpFunc     udpFunc,
                           MolochPluginTcpFunc     tcpFunc,
                           MolochPluginSaveFunc    saveFunc,
                           MolochPluginNewFunc     newFunc,
                           MolochPluginExitFunc    exitFunc,
                           MolochPluginExitFunc    reloadFunc);

void moloch_plugins_set_http_cb(const char *             name,
                                MolochPluginHttpFunc     on_message_begin,
                                MolochPluginHttpDataFunc on_url,
                                MolochPluginHttpDataFunc on_header_field,
                                MolochPluginHttpDataFunc on_header_value,
                                MolochPluginHttpFunc     on_headers_complete,
                                MolochPluginHttpDataFunc on_body,
                                MolochPluginHttpFunc     on_message_complete);

void moloch_plugins_set_smtp_cb(const char *                name,
                                MolochPluginSMTPHeaderFunc  on_header,
                                MolochPluginSMTPFunc        on_header_complete);

void moloch_plugins_cb_save(MolochSession_t *session, int final);
void moloch_plugins_cb_new(MolochSession_t *session);
void moloch_plugins_cb_ip(MolochSession_t *session, struct ip *packet, int len);
void moloch_plugins_cb_udp(MolochSession_t *session, struct udphdr *udphdr, unsigned char *data, int len);
void moloch_plugins_cb_tcp(MolochSession_t *session, struct tcp_stream *a_tcp);

void moloch_plugins_cb_hp_omb(MolochSession_t *session, http_parser *parser);
void moloch_plugins_cb_hp_ou(MolochSession_t *session, http_parser *parser, const char *at, size_t length);
void moloch_plugins_cb_hp_ohf(MolochSession_t *session, http_parser *parser, const char *at, size_t length);
void moloch_plugins_cb_hp_ohv(MolochSession_t *session, http_parser *parser, const char *at, size_t length);
void moloch_plugins_cb_hp_ohc(MolochSession_t *session, http_parser *parser);
void moloch_plugins_cb_hp_ob(MolochSession_t *session, http_parser *parser, const char *at, size_t length);
void moloch_plugins_cb_hp_omc(MolochSession_t *session, http_parser *parser);

void moloch_plugins_cb_smtp_oh(MolochSession_t *session, const char *field, size_t field_len, const char *value, size_t value_len);
void moloch_plugins_cb_smtp_ohc(MolochSession_t *session);

void moloch_plugins_exit();

/******************************************************************************/
/*
 * yara.c
 */
void moloch_yara_init();
void moloch_yara_execute(MolochSession_t *session, char *data, int len, int first);
void moloch_yara_email_execute(MolochSession_t *session, char *data, int len, int first);
void moloch_yara_exit();

/******************************************************************************/
/*
 * field.c
 */

enum {
MOLOCH_FIELD_USER,

MOLOCH_FIELD_HTTP_HOST,
MOLOCH_FIELD_HTTP_URLS,
MOLOCH_FIELD_HTTP_XFF,
MOLOCH_FIELD_HTTP_UA,
MOLOCH_FIELD_HTTP_TAGS_REQ,
MOLOCH_FIELD_HTTP_TAGS_RES, // Must be right after REQ
MOLOCH_FIELD_HTTP_MD5,

MOLOCH_FIELD_SSH_VER,
MOLOCH_FIELD_SSH_KEY,

MOLOCH_FIELD_DNS_IP,
MOLOCH_FIELD_DNS_HOST,

MOLOCH_FIELD_EMAIL_HOST,
MOLOCH_FIELD_EMAIL_UA,
MOLOCH_FIELD_EMAIL_SRC,
MOLOCH_FIELD_EMAIL_DST,
MOLOCH_FIELD_EMAIL_SUB,
MOLOCH_FIELD_EMAIL_ID,
MOLOCH_FIELD_EMAIL_CT,
MOLOCH_FIELD_EMAIL_MV,
MOLOCH_FIELD_EMAIL_FN,
MOLOCH_FIELD_EMAIL_MD5,
MOLOCH_FIELD_EMAIL_FCT,
MOLOCH_FIELD_EMAIL_IP,

MOLOCH_FIELD_TAGS, // Must be last
};

void moloch_field_init();
int moloch_field_define(char *name, int type, int flags);
void moloch_field_define_internal(int pos, char *name, int type, int flags);
gboolean moloch_field_string_add(int pos, MolochSession_t *session, char *string, int len, gboolean copy);
gboolean moloch_field_int_add(int pos, MolochSession_t *session, int i);
void moloch_field_free(MolochSession_t *session);
void moloch_field_exit();

/******************************************************************************/
/*
 * js0n.c
 */
int js0n(unsigned char *js, unsigned int len, unsigned int *out);
