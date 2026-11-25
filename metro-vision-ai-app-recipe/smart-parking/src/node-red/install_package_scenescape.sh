#!/bin/bash

set -e

# The package is installed locally (not globally) into the persistent
# node-red-node-modules volume, so check there to skip reinstalling on restart.
cd /usr/src/node-red
if [ ! -d node_modules/node-red-contrib-influxdb ]; then
    npm install --no-audit --no-fund node-red-contrib-influxdb
fi
