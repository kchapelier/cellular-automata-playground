"use strict";

// when adding colors check out the LSB MSB issue

var CellularAutomata = require('cellular-automata'),
    color0 = 0xFF000000,
    color1 = 0xFFFFFFFF;

function createImageData (rawData, width, height) {
    var imageData = new Uint32Array(rawData.length),
        i,
        i2,
        x,
        y;

    for (i = 0; i < rawData.length; i++) {
        //rotate 90°
        x = (i % height) | 0;
        y = (i / height) | 0;
        i2 = (x * width + y);

        imageData[i2] = rawData[i] ? color1 : color0;
    }

    return imageData.buffer;
}

self.addEventListener('message', function onMessage (e) {
    var time = Date.now();
    var ca = new CellularAutomata([e.data.width, e.data.height]),
        rules = e.data.rules,
        response = {
            result: null,
            final: false
        },
        i = 0,
        k = 0;

    ca.setOutOfBoundValue(e.data.outValue);

    if (e.data.animated) {
        for (i = 0; i < rules.length; i++) {
            ca.setRule(rules[i].rule);
            for (k = 0; k < rules[i].iterations; k++) {
                ca.iterate();

                response.result = createImageData(ca.array.data, e.data.width, e.data.height);
                response.final = (i === rules.length - 1) && (k === rules[i].iterations - 1);
                self.postMessage(response, [response.result]);
            }
        }
    } else {
        for (i = 0; i < rules.length; i++) {
            if (rules[i].iterations > 0) {
                ca.apply(rules[i].rule, rules[i].iterations);
            }
        }
        console.log('CPU:' + (Date.now() - time) + 'ms');

        response.result = createImageData(ca.array.data, e.data.width, e.data.height);
        response.final = true;
        self.postMessage(response, [response.result]);
    }
});
