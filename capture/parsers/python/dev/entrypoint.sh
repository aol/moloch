#!/bin/bash

# init moloch
rm /data/moloch/etc/config.ini > /dev/null 2>&1; 
echo -e '\n\nhttp://elasticsearch:9200\npassword\nno\n' | /data/moloch/bin/Configure > /dev/null;
 
# Enable python.parsers.js to capture Plugins
sed -i 's/# plugins=tagger.so; netflow.so; python.parsers.so/plugins=python.parsers.so/g' /data/moloch/etc/config.ini; 
# Enable python.parsers.js viewer Plugins
sed -i 's/# viewerPlugins=wise.js; python.parsers.js/viewerPlugins=python.parsers.js/g' /data/moloch/etc/config.ini;
# Set isLocalViewRegExp to .* (viewer will search pcaps on the instance itself) 
sed -i 's/# NetFlowPlugin/isLocalViewRegExp=.*/g' /data/moloch/etc/config.ini; 
# Set packetThreads to 1  
sed -i 's/packetThreads=2/packetThreads=1/g' /data/moloch/etc/config.ini;

# set debugging flags
export __debug__=server

if [ $# -eq 0 ] ; then
    echo "Usage: moloch [action]"
    echo "actions:"
    echo "  init      - init elasticsearch database"
    echo "  reinit    - (re)init elasticsearch database"
    echo "  capture   - run moloch capture on pcaps in the raw directory"
    echo "  viewer    - spawn a moloch viewer process"
    echo "  CMD       - run CMD"
    exit -1
fi

if [ -z "$WAIT_TIME" ] ; then
    WAIT_TIME=1
fi

function elasticsearch-ready {
    until [ $(curl --write-out %{http_code} --silent --output /dev/null http://elasticsearch:9200/_cat/health?h=st) = 200 ];
    do 
        echo 'awaiting elasticsearch ready...'
        sleep $WAIT_TIME;
    done
}

function moloch-version {
    /data/moloch/db/db.pl http://elasticsearch:9200 info | grep 'DB Version' | grep -P '\-?\d+' -o
}

function moloch-ready {    
    until [ $(moloch-version) != -1 ];
    do 
        echo 'awaiting moloch ready...'
        sleep $WAIT_TIME;
    done
}

#await elasticsearch ready
elasticsearch-ready

if [ $1 = "init" ] || [ $1 = "reinit" ] ; then
    
    if [ $1 = "init" ] && [ $(moloch-version) != -1 ] ; then

        echo 'Moloch already initialized'

    else 
    
        echo 'INIT' | /data/moloch/db/db.pl http://elasticsearch:9200 init
        /data/moloch/bin/moloch_add_user.sh admin 'Admin User' admin --admin

    fi

elif [ $1 = "viewer" ] ; then

    moloch-ready
    cd /data/moloch/viewer;
    /data/moloch/bin/node /data/moloch/viewer/viewer.js -c /data/moloch/etc/config.ini;
    
elif [ $1 = "capture" ] ; then

    moloch-ready
    if [ $# -eq 1 ] ; then
        /data/moloch/bin/moloch-capture -R raw
    else
        /data/moloch/bin/moloch-capture ${@:2}
    fi

else
    ${@:1}
fi

