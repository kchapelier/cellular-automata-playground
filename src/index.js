"use strict";

// this may or may not need some serious refactoring, the interesting stuff is in the worker anyway

var CellularAutomataGpu = require('cellular-automata-gpu');

var RuleList = require('./rule-list');

var clamp = function clamp (v, min, max) {
    return Math.min(Math.max(v, min), max);
};

var ruleList = new RuleList(
    document.querySelector('.rule-list'),
    document.querySelector('.add-rule'),
    document.querySelector('.bin'),
    document.getElementById('template-rule')
);

function selectOption (select, value) {
    var options = select.options,
        i = 0;

    value = value.toString();

    for (; i < options.length; i++) {
        options[i].selected = (value === options[i].value);
    }
}

function createWorker (script) {
    var now = Date.now();

    return new Worker(script + '?cache=' + now);
}

var widthElement = document.getElementById('width');
var heightElement = document.getElementById('height');
var outValueElement = document.getElementById('outValue');

var engineElement = document.getElementById('engine');
var animationSpeedElement = document.getElementById('animationSpeed');
var zoomElement = document.getElementById('zoom');

var reloadButtonElement = document.getElementById('reload');

var worker = createWorker ('build/worker.js');

var canvas = document.querySelector('canvas');
var context = canvas.getContext('2d');

var imageData = context.createImageData(100, 100);

var busy = false;
var queue = [];
var queueIndex = 0;

worker.addEventListener('message', function (e) {
    queue.push(e.data);
});

function updateHash () {
    var baseUrl = document.location.origin + document.location.pathname,
        ruleString = '';

    for (var i = 0; i < data.rules.length; i++) {
        ruleString+= '&rule=' + encodeURI(data.rules[i].rule.replace(/ /g, '_')) + '*' + data.rules[i].iterations;
    }

    document.location.hash = '#width=' + data.width + '&height=' + data.height + '&oov=' + data.outValue + ruleString;
}

function parseLink () {
    var data = {
        d:2,
        width: 100,
        height: 100,
        outValue: 1,
        rules: []
    };

    var rule;

    document.location.hash.split(/[#&]/g).map(function(option) {
        option = option.split('=');

        switch (option[0]) {
            case 'width':
                data.width = clamp(parseInt(option[1], 10), 1, 600);
                break;
            case 'height':
                data.height = clamp(parseInt(option[1], 10), 1, 600);
                break;
            case 'oov':
                data.outValue = option[1];
                break;
            case 'rule':
                rule = decodeURI(option[1]).split('*');
                data.rules.push({
                    rule: rule[0].replace(/_/g, ' '),
                    iterations: clamp(parseInt(rule[1], 10) || 0, 0, 1000)
                });
                break;
        }
    });

    return data;

}

var sceneOptions = {
    gpu: false,
    zoom: 2,
    animationSpeed: 10
};

animationSpeedElement.addEventListener('change', function () {
    sceneOptions.animationSpeed = parseInt(animationSpeedElement.value, 10);
});

engineElement.addEventListener('change', function () {
    sceneOptions.gpu = (engineElement.value === 'gpu');
});

zoomElement.addEventListener('change', function () {
    sceneOptions.zoom = parseInt(zoomElement.value, 10);
    changeZoomCanvas();
});

var data = parseLink();


for (var i = 0; i < data.rules.length; i++) {
    ruleList.addRule(data.rules[i].rule, data.rules[i].iterations);
}

widthElement.value = data.width;
heightElement.value = data.height;
selectOption(outValueElement, data.outValue);

var lastTime = -999;
function update (currentTime) {
    requestAnimationFrame(update);

    if (queueIndex < queue.length && currentTime - lastTime >= sceneOptions.animationSpeed) {
        if (sceneOptions.animationSpeed === 0) {
            queueIndex = queue.length - 1;
        }

        var iteration = queue[queueIndex];

        resizeCanvas();

        imageData = new ImageData(new Uint8ClampedArray(iteration.result), data.width, data.height);

        if (iteration.final) {
            busy = false;
            document.body.classList.remove('busy');
        }

        context.putImageData(imageData, 0, 0);
        queue[queueIndex] = null;
        queueIndex++;
        lastTime = currentTime;
    }

    if (queueIndex > 0 && queueIndex === queue.length) {
        queueIndex = 0;
        queue.length = 0;
    }
}

update(0);

function updateData () {
    data.width = parseInt(widthElement.value, 10);
    data.height = parseInt(heightElement.value, 10);
    data.outValue = outValueElement.value;
    data.rules = ruleList.rules.filter(function (rule) { return rule.valid && rule.iterations; });
    data.animated = sceneOptions.animationSpeed > 0;
}

function changeZoomCanvas () {
    canvas.style.width = (canvas.width * sceneOptions.zoom) + 'px';
    canvas.style.height = (canvas.height * sceneOptions.zoom) + 'px';
}

function resizeCanvas () {
    canvas.width = data.width;
    canvas.height = data.height;
    canvas.style.width = (data.width * sceneOptions.zoom) + 'px';
    canvas.style.height = (data.height * sceneOptions.zoom) + 'px';
}

var color0 = 0xFF000000,
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

function processInGpu (data) {
    var time = Date.now();
    var ca = new CellularAutomataGpu([data.width, data.height]);
    ca.setOutOfBoundValue(data.outValue);

    for (var i = 0; i < data.rules.length; i++) {
        var rule = data.rules[i];

        if (rule.valid && rule.iterations > 0) {
            ca.apply(rule.rule, rule.iterations);
        }
    }

    ca.finalize();
    console.log('GPU: ' + (Date.now() - time) + 'ms');
    ca.destroy();

    queue.push({
        result: createImageData(ca.array.data, data.width, data.height),
        final: true
    });
}

function reload () {
    if (busy) return;

    updateData();

    if (data.rules.length > 0) {
        busy = true;
        document.body.classList.add('busy');

        if (sceneOptions.gpu) {
            processInGpu(data);
        } else {
            worker.postMessage(data);
        }

        updateHash();
    }
}

document.body.addEventListener('keyup', function (e) {
    if (e.keyCode === 13) {
        reload();
    }
});

reload();
