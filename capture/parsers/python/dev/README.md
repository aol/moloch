#Docker services
##Start elasticsearch:9200 and moloch viewer:8005 with a initialized moloch db
docker-compose up -d

##Reset moloch db
docker-compose run moloch reinit

##Run moloch-capture on all pcaps in ./raw
docker-compose run moloch capture

##Run moloch-capture on specific pcap in ./raw
docker-compose run moloch capture -r raw/file.pcap

##Run restart moloch viewer (this will reload jade files)
docker-compose restart moloch viewer

##Run a shell within a moloch container
docker-compose run moloch bash

#Debugging
When running a moloch capture a log file will be created in the logs directory
This log file can be used to reply the moloch capture session and debug the plugin.

##Setup debugging:
Run your debugger of choice with the following settings:
    Set a enviroument variable "__debug__" with the value "client"
    Set the working directory to moloch/capture/parsers/python
    

