FROM debian:stretch

RUN apt-get update; 
RUN apt-get install -y git-core;

WORKDIR /build/moloch

RUN git clone https://github.com/UnmanagedCode/moloch.git .

RUN apt-get install -y sudo;
RUN apt-get install -y python python3;
RUN apt-get install -y autoconf;

RUN autoconf
RUN ./easybutton-build.sh
RUN (cd capture/plugins/python; make)

RUN ./easybutton-build.sh --install
RUN (cd capture/plugins/python; make install)

WORKDIR /data/moloch

RUN ./bin/moloch_update_geo.sh

# # Add getApp to api (this allows for extension of the webapp)
# RUN sed -i 's/api = {/api = { getApp: function() { return app; },/g' /data/moloch/viewer/viewer.js;

# # Remove sanitize from decoder html output (this allows for richer html output and use of javascript in the decoder)
# RUN sed -i 's/packetHtml=\w()/packetHtml=(function(x){return x;})/g' $(grep 'packetHtml=' -l /data/moloch/viewer/vueapp/dist/static/js/*);

