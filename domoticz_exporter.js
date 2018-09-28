#!/usr/bin/env node
'use strict';

// Requirements
const http = require('http');
const fetch = require("node-fetch");
const prom = require('prom-client');
const commandLineArgs = require('command-line-args')

// Constants
const appName = 'domoticz';
const labelNames = ['name','idx','type','subtype','hardwarename','hardwaretype',];

// Get args and set options
const argOptions = commandLineArgs([
    { name: 'port', alias: 'p', type: Number, defaultValue: process.env.DOMOTICZ_PORT || 9486, },
    { name: 'hostip', type: String, defaultValue: process.env.DOMOTICZ_HOSTIP || '127.0.0.1', },
    { name: 'hostport', type: Number, defaultValue: process.env.DOMOTICZ_HOSTPORT || 8080, },
    { name: 'hostssl', type: Boolean, },
    { name: 'collectdefault', type: Boolean, },
]);
const port = argOptions.port;
const domoticzIP = argOptions.hostip;
const domoticzPort = argOptions.hostport;
const domoticzSsl = process.env.DOMOTICZ_HOSTSSL || argOptions.hostssl;
if (domoticzSsl) {
    domoticzPort = 443;
}
const collectDefaultMetrics = process.env.DOMOTICZ_DEFAULTMETRICS || argOptions.collectdefault;

// Initialize prometheus metrics.
const gaugeLightLevel = new prom.Gauge({
    'name': appName + '_light_level',
    'help': 'Lighting device level 0-100 or 0-255',
    'labelNames': labelNames,
});
const gaugeLightStatus = new prom.Gauge({
    'name': appName + '_light_status',
    'help': 'Lighting device status 0=off 1=on',
    'labelNames': labelNames,
});
const gaugeLightBatteryLevel = new prom.Gauge({
    'name': appName + '_light_battery_level',
    'help': 'Lighting device battery level 0-100 or 0-255',
    'labelNames': labelNames,
});
const gaugeTempTemp = new prom.Gauge({
    'name': appName + '_temp_temp',
    'help': 'Temperature device temperature',
    'labelNames': labelNames,
});
const gaugeTempHumidity = new prom.Gauge({
    'name': appName + '_temp_humidity',
    'help': 'Temperature device humidity percentage 0-100',
    'labelNames': labelNames,
});
const gaugeTempBatteryLevel = new prom.Gauge({
    'name': appName + '_temp_battery_level',
    'help': 'Temperature device battery level 0-100 or 0-255',
    'labelNames': labelNames,
});
const gaugeWeatherTemp = new prom.Gauge({
    'name': appName + '_weather_temp',
    'help': 'Weather device temperature',
    'labelNames': labelNames,
});
const gaugeWeatherHumidity = new prom.Gauge({
    'name': appName + '_weather_humidity',
    'help': 'Weather device humidity percentage 0-100',
    'labelNames': labelNames,
});
const gaugeWeatherBarometer = new prom.Gauge({
    'name': appName + '_weather_barometer',
    'help': 'Weather device barometer',
    'labelNames': labelNames,
});
const gaugeWeatherBatteryLevel = new prom.Gauge({
    'name': appName + '_weather_battery_level',
    'help': 'Weather device battery level 0-100 or 0-255',
    'labelNames': labelNames,
});
const gaugeUtilityData = new prom.Gauge({
    'name': appName + '_utility_data',
    'help': 'Utility device data',
    'labelNames': labelNames,
});
const gaugeUtilityBatteryLevel = new prom.Gauge({
    'name': appName + '_utility_battery_level',
    'help': 'Utility device battery level 0-100 or 0-255',
    'labelNames': labelNames,
});

// Register all metrics
console.log(`INFO: Registering Prometheus metrics...`);
const register = new prom.Registry();
register.registerMetric(gaugeLightLevel);
register.registerMetric(gaugeLightStatus);
register.registerMetric(gaugeLightBatteryLevel);
register.registerMetric(gaugeTempTemp);
register.registerMetric(gaugeTempHumidity);
register.registerMetric(gaugeTempBatteryLevel);
register.registerMetric(gaugeWeatherTemp);
register.registerMetric(gaugeWeatherHumidity);
register.registerMetric(gaugeWeatherBarometer);
register.registerMetric(gaugeWeatherBatteryLevel);
register.registerMetric(gaugeUtilityData);
register.registerMetric(gaugeUtilityBatteryLevel);
if (collectDefaultMetrics) {
    prom.collectDefaultMetrics({
        timeout: 5000,
        register: register,
        prefix: appName + '_',
    });
}

// Start Server.
console.log(`INFO: Starting HTTP server...`);
const server = http.createServer((req, res) => {
    // Only allowed to poll prometheus metrics.
    if (req.method !== 'GET') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('Support GET only');
    }
    res.setHeader('Content-Type', register.contentType);
    gatherMetrics().then(() => {
        res.end(register.metrics());
    });
}).listen(port);
server.setTimeout(30000);
console.log(`INFO: Domoticz exporter listening on port ${port}`);

// Build the Domoticz API URL
function buildUrl({
    ssl,
    ip,
    port,
    type,
}) {
    let protocol = 'http://';
    if (ssl) {
        port = 443;
        protocol = 'https://'
    }
    return protocol + ip + ':' + port + '/json.htm?type=devices&filter=' + type + '&used=true&order=Name'
}

// Get all devices of a particular device type from Domoticz
async function fetchDevices({
    type,
}) {
    try {
        let response = await fetch(buildUrl({ ssl: domoticzSsl, ip: domoticzIP, port: domoticzPort, type: type }));
        let json = await response.json();
        return json;
    } catch (err) {
        console.log('ERROR: Unable to connect to Domoticz.  Check IP and port.');
        console.log('ERROR: ' + err);
    }
}

// Turn a device into Prometheus labels
function getLabels(device) {
    return {
        'name': device.Name,
        'idx': device.idx,
        'type': device.Type,
        'subtype': device.SubType,
        'hardwarename': device.HardwareName,
        'hardwaretype': device.HardwareType,
    };
}

// Main function to get the metrics for each container
async function gatherMetrics() {
    try {
        // Reset all to zero before proceeding
        register.resetMetrics();

        // Get all device type in parallel 
        let lightsPromise = fetchDevices({ type: 'light' });
        let tempsPromise = fetchDevices({ type: 'temp' });
        let weathersPromise = fetchDevices({ type: 'weather' });
        let utilitiesPromise = fetchDevices({ type: 'utility' });

        // process light metrics
        let lights = await lightsPromise;
        if (lights.result && Array.isArray(lights.result) && lights.result.length) {
            for (let device of lights.result) {
                const labels = getLabels(device);
                if (device.Level) {
                    gaugeLightLevel.set(labels, device.Level);
                }
                if (device.Status) {
                    gaugeLightStatus.set(labels, device.Status.toUpperCase() == 'ON' ? 1 : 0);
                }
                if (device.BatteryLevel) {
                    gaugeLightBatteryLevel.set(labels, device.BatteryLevel);
                }
            }
        }

        // process temp metrics
        let temps = await tempsPromise;
        if (temps.result && Array.isArray(temps.result) && temps.result.length) {
            for (let device of temps.result) {
                const labels = getLabels(device);
                if (device.Temp) {
                    gaugeTempTemp.set(labels, device.Temp);
                }
                if (device.Humidity) {
                    gaugeTempHumidity.set(labels, device.Humidity);
                }
                if (device.BatteryLevel) {
                    gaugeTempBatteryLevel.set(labels, device.BatteryLevel);
                }
            }
        }

        // process weather metrics
        let weathers = await weathersPromise;
        if (weathers.result && Array.isArray(weathers.result) && weathers.result.length) {
            for (let device of weathers.result) {
                const labels = getLabels(device);
                if (device.Temp) {
                    gaugeWeatherTemp.set(labels, device.Temp);
                }
                if (device.Humidity) {
                    gaugeWeatherHumidity.set(labels, device.Humidity);
                }
                if (device.Barometer) {
                    gaugeWeatherBarometer.set(labels, device.Barometer);
                }
                if (device.BatteryLevel) {
                    gaugeWeatherBatteryLevel.set(labels, device.BatteryLevel);
                }
            }
        }

        // process utility metrics
        let utilities = await utilitiesPromise;
        if (utilities.result && Array.isArray(utilities.result) && utilities.result.length) {
            for (let device of utilities.result) {
                const labels = getLabels(device);
                if (device.Data) {
                    // convert data to purely a number
                    let data = parseFloat(device.Data.replace(/[^\d.-]/g, ''));
                    if (data) {
                        gaugeUtilityData.set(labels, data);
                    }
                }
                if (device.BatteryLevel) {
                    gaugeUtilityBatteryLevel.set(labels, device.BatteryLevel);
                }
            }
        }

    } catch (err) {
        console.log('ERROR: ' + err);
    }
}

