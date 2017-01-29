"use strict";

// this may or may not need some serious refactoring, the interesting stuff is in the worker anyway

var CellularAutomataGpu = require('cellular-automata-gpu');

var RuleList = require('./rule-list');
var TwoDimensionsRenderer = require('./2d-renderer');
var ThreeDimensionsRenderer = require('./3d-renderer');

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
var depthElement = document.getElementById('depth');
var outValueElement = document.getElementById('outValue');

var engineElement = document.getElementById('engine');
var animationSpeedElement = document.getElementById('animationSpeed');
var zoomElement = document.getElementById('zoom');
var dimensionElement = document.getElementById('dimension');

var worker = createWorker ('build/worker.js');

var container = document.querySelector('.canvas-container');

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

    document.location.hash = '#d=' + data.d + '&width=' + data.width + '&height=' + data.height + (data.d === 3 ? '&depth=' + data.depth : '') +  '&oov=' + data.outValue + ruleString;
}

function parseLink () {
    var data = {
        d:2,
        width: 100,
        height: 100,
        depth: 100,
        outValue: 1,
        rules: []
    };

    var rule;

    document.location.hash.split(/[#&]/g).map(function(option) {
        option = option.split('=');

        switch (option[0]) {
            case 'd':
                data.d = clamp(parseInt(option[1], 10), 2, 3);
                break;
            case 'width':
                data.width = clamp(parseInt(option[1], 10), 1, 600);
                break;
            case 'height':
                data.height = clamp(parseInt(option[1], 10), 1, 600);
                break;
            case 'depth':
                data.depth = clamp(parseInt(option[1], 10), 1, 600);
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
    renderer.setZoom(sceneOptions.zoom);
});

var data = parseLink();

var renderer2d = new TwoDimensionsRenderer(container, sceneOptions.zoom),
    renderer3d = new ThreeDimensionsRenderer(container, sceneOptions.zoom),
    renderer = renderer2d;

function setDimension(dimension) {
    if (dimension === 3) {
        document.body.classList.add('three-d');
        sceneOptions.gpu = true;
        selectOption(engineElement, 'gpu');
    } else {
        document.body.classList.remove('three-d');
    }
}

dimensionElement.addEventListener('change', function () {
    data.d = clamp(parseInt(dimensionElement.value, 10), 2, 3);
    setDimension(data.d);
});

for (var i = 0; i < data.rules.length; i++) {
    ruleList.addRule(data.rules[i].rule, data.rules[i].iterations);
}

widthElement.value = data.width;
heightElement.value = data.height;
depthElement.value = data.depth;
selectOption(outValueElement, data.outValue);
selectOption(dimensionElement, data.d);
setDimension(data.d);

var lastTime = -999;
function update (currentTime) {
    requestAnimationFrame(update);

    if (queueIndex < queue.length && currentTime - lastTime >= sceneOptions.animationSpeed) {
        if (sceneOptions.animationSpeed === 0) {
            queueIndex = queue.length - 1;
        }

        var iteration = queue[queueIndex];

        if (iteration.final) {
            busy = false;
            document.body.classList.remove('busy');
        }

        renderer.displayImageData(iteration.result);

        queue[queueIndex] = null;
        queueIndex++;
        lastTime = currentTime;
    }

    if (queueIndex > 0 && queueIndex === queue.length) {
        queueIndex = 0;
        queue.length = 0;
    }

    renderer.animationFrame();
}

update(0);

function updateData () {
    data.d = parseInt(dimensionElement.value, 10);
    data.width = parseInt(widthElement.value, 10);
    data.height = parseInt(heightElement.value, 10);
    data.depth = parseInt(depthElement.value, 10);
    data.outValue = outValueElement.value;
    data.rules = ruleList.rules.filter(function (rule) { return rule.valid && rule.iterations; });
    data.animated = sceneOptions.animationSpeed > 0;
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
    var is3D = data.d === 3;
    var caShape = is3D ? [data.width, data.height, data.depth] : [data.width, data.height];
    var ca = new CellularAutomataGpu(caShape);

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

    if (is3D) {
        renderer3d.displayRawData(ca.array);

        busy = false;
        document.body.classList.remove('busy');
    } else {
        queue.push({
            result: createImageData(ca.array.data, data.width, data.height),
            final: true
        });
    }
}

function reload () {
    if (busy) return;

    updateData();

    if (data.d === 3) {
        renderer = renderer3d;
        renderer3d.show();
        renderer2d.hide();
    } else {
        renderer = renderer2d;
        renderer3d.hide();
        renderer2d.show();
    }

    renderer.resizeShape([data.width, data.height]);

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

window.addEventListener('resize', function () {
    renderer2d.resizeWindow();
    renderer3d.resizeWindow();
});

reload();
