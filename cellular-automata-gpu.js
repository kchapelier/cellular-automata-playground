!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var f;"undefined"!=typeof window?f=window:"undefined"!=typeof global?f=global:"undefined"!=typeof self&&(f=self),f.CellularAutomataGpu=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var utils = require('./lib/utils'),
    parser = require('cellular-automata-rule-parser'),
    generateShaders2D = require('./lib/cellular-automata-glsl-2d'),
    generateShaders3D = require('./lib/cellular-automata-glsl-3d'),
    GpuBackend = require('./lib/cellular-automata-gpu-backend'),
    moore = require('moore'),
    vonNeumann = require('von-neumann'),
    unconventionalNeighbours = require('unconventional-neighbours');

var neighbourhoodFunctions = {
    'moore': moore,
    'von-neumann': vonNeumann,
    'axis': unconventionalNeighbours.axis,
    'corner': unconventionalNeighbours.corner,
    'edge': unconventionalNeighbours.edge,
    'face': unconventionalNeighbours.face
};

/**
 * Sort the neighbourhood from left to right, top to bottom, ...
 * @param {Array} a First neighbour
 * @param {Array} b Second neighbour
 * @returns {number}
 */
var neighbourhoodSorter = function neighbourhoodSorter (a, b) {
    a = a.join(',');
    b = b.join(',');
    return a > b ? 1 : a < b ? -1 : 0;
};

var getNeighbourhood = function getNeighbourhood(neighbourhoodType, neighbourhoodRange, dimension) {
    neighbourhoodType = !!neighbourhoodFunctions[neighbourhoodType] ? neighbourhoodType : 'moore';
    neighbourhoodRange = neighbourhoodRange || 1;
    dimension = dimension || 2;

    var neighbourhood = neighbourhoodFunctions[neighbourhoodType](neighbourhoodRange, dimension);
    neighbourhood.sort(neighbourhoodSorter);

    return neighbourhood;
};

/**
 * CellularAutomataGpu constructor
 * @param {int[]} shape Shape of the grid
 * @param {int} [defaultValue=0] Default value of the cells
 * @constructor
 */
var CellularAutomataGpu = function CellularAutomataGpu (shape, defaultValue) {
    this.shape = shape;
    this.dimension = shape.length;

    if (this.dimension !== 2 && this.dimension !== 3) {
        throw new Error('CellularAutomataGpu does not support dimensions other than 2 and 3.');
    }

    defaultValue = defaultValue || 0;

    this.array = utils.createArray(shape, defaultValue);
    this.backend = new GpuBackend(this.shape);
    this.rules = [];
};

CellularAutomataGpu.prototype.shape = null;
CellularAutomataGpu.prototype.dimension = null;
CellularAutomataGpu.prototype.array = null;

CellularAutomataGpu.prototype.currentRule = null;
CellularAutomataGpu.prototype.rules = null;
CellularAutomataGpu.prototype.backend = null;

CellularAutomataGpu.prototype.outOfBoundValue = 0;
CellularAutomataGpu.prototype.outOfBoundWrapping = false;
CellularAutomataGpu.prototype.outOfBoundClamping = false;

/**
 * Fill the grid with a given distribution
 * @param {Array[]} distribution The distribution to fill the grid with (ie: [[0,90], [1,10]] for 90% of 0 and 10% of 1). Null values are ignored.
 * @param {function} [rng=Math.random] A random number generation function, default to Math.random()
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.fillWithDistribution = function (distribution, rng) {
    var sum = 0,
        array = this.array.data,
        numberOfDistributions = distribution.length,
        selection,
        i,
        k;

    rng = rng || Math.random;

    for (i = 0; i < numberOfDistributions; i++) {
        sum += distribution[i][1];
    }

    for (k = 0; k < array.length; k++) {
        selection = rng() * sum;

        for (i = 0; i < numberOfDistributions; i++) {
            selection -= distribution[i][1];
            if (selection <= 0 && distribution[i][0] !== null) {
                array[k] = distribution[i][0];
                break;
            }
        }
    }

    return this;
};

/**
 * Define the value used for the cells out of the array's bounds
 * @param {int|string} [outOfBoundValue=0] Any integer value or the string "wrap" to enable out of bound wrapping.
 * @public
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.setOutOfBoundValue = function (outOfBoundValue) {
    if (outOfBoundValue === 'clamp') {
        this.outOfBoundClamping = true;
        this.outOfBoundWrapping = false;
        this.outOfBoundValue = 0;
    } else if (outOfBoundValue === 'wrap') {
        this.outOfBoundClamping = false;
        this.outOfBoundWrapping = true;
        this.outOfBoundValue = 0;
    } else {
        this.outOfBoundClamping = false;
        this.outOfBoundWrapping = false;
        this.outOfBoundValue = outOfBoundValue | 0;
    }

    if (this.currentRule !== null) {
        this.currentRule = {
            rule: this.currentRule.rule,
            shaders: null,
            iteration: 0
        }
    }

    return this;
};

/**
 * Define the rule of the cellular automata and the neighbourhood to be used.
 * @param {string} rule A rule string in Life, Vote for life, LUKY or Extended format.
 * @public
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.setRule = function (rule) {
    var parsedRule = parser(rule);

    if (rule === 'debug') {
        parsedRule = { ruleFormat: 'debug' };
    }

    if (parsedRule === null) {
        throw new Error('The rulestring could not be parsed.');
    }

    this.currentRule = {
        rule: parsedRule,
        shaders: null,
        iteration: 0
    };

    return this;
};

/**
 * Apply the previously defined CA rule multiple times.
 * @param {int} [iterationNumber=1] Number of iterations
 * @public
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.iterate = function (iterationNumber) {
    iterationNumber = iterationNumber || 1;

    if (this.currentRule.iteration === 0) {
        var neighbourhood = getNeighbourhood(this.currentRule.rule.neighbourhoodType, this.currentRule.rule.neighbourhoodRange, this.dimension),
            outOfBoundValue = this.outOfBoundClamping ? 'clamp' : (this.outOfBoundWrapping ? 'wrap' : this.outOfBoundValue);

        if (this.dimension === 2) {
            this.currentRule.shaders = generateShaders2D(this.currentRule.rule, neighbourhood, this.shape, this.backend.viewportWidth, this.backend.viewportHeight, outOfBoundValue);
        } else if (this.dimension === 3) {
            this.currentRule.shaders = generateShaders3D(this.currentRule.rule, neighbourhood, this.shape, this.backend.viewportWidth, this.backend.viewportHeight, outOfBoundValue);
        }
        this.rules.push(this.currentRule);
    }

    this.currentRule.iteration += iterationNumber;

    return this;
};

/**
 * Apply a given rule for a given number of iterations, shortcut method for setRule and iterate
 * @param {string} rule A rule string in Life, Vote for life, LUKY or Extended format.
 * @param {int} [iteration=1] Number of iterations
 * @public
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.apply = function (rule, iteration) {
    return this.setRule(rule).iterate(iteration);
};

/**
 * Execute all the stored operation on the GPU
 * @public
 * @returns {CellularAutomataGpu} CellularAutomataGpu instance for method chaining.
 */
CellularAutomataGpu.prototype.finalize = function () {
    if (this.rules.length) {
        this.backend.write(this.array);

        for (var i = 0; i < this.rules.length; i++) {
            this.backend.execute(this.rules[i]);
        }

        this.backend.read(this.array);

        this.rules = [];
    }

    return this;
};

module.exports = CellularAutomataGpu;


},{"./lib/cellular-automata-glsl-2d":2,"./lib/cellular-automata-glsl-3d":3,"./lib/cellular-automata-gpu-backend":4,"./lib/utils":6,"cellular-automata-rule-parser":17,"moore":21,"unconventional-neighbours":27,"von-neumann":29}],2:[function(require,module,exports){
"use strict";

var uniq = require('uniq');

var printFloat = function printFloat (v) {
    return (v === v|0 ? v.toFixed(1) : v.toString(10));
};

var generateGetPixelGlsl = function generateGetPixelGlsl (outOfBoundValue) {
    outOfBoundValue = outOfBoundValue || 0;

    if (outOfBoundValue === 'clamp') {
        return [
            'int getPixel(const in vec2 currentPos, const in vec2 add) {',
            '  vec2 pixelPos = clamp(currentPos + add, vec2(0.), iResolution - vec2(1.)) / iResolution;',
            '  return unpackValue(texture2D(iBackbuffer, pixelPos).x);',
            '}'
        ].join('\n');
    } else if (outOfBoundValue === 'wrap') {
        return [
            'int getPixel(const in vec2 currentPos, const in vec2 add) {',
            '  vec2 pixelPos = fract((currentPos + add) / iResolution);',
            '  return unpackValue(texture2D(iBackbuffer, pixelPos).x);',
            '}'
        ].join('\n');
    } else {
        return [
            'int getPixel(const in vec2 currentPos, const in vec2 add) {',
            '  vec2 pixelPos = (currentPos + add) / iResolution;',
            '  if(pixelPos.x < 0. || pixelPos.y < 0. || pixelPos.x >= 1. || pixelPos.y >= 1.) {',
            '    return ' + outOfBoundValue + ';',
            '  } else {',
            '    return unpackValue(texture2D(iBackbuffer, pixelPos).x);',
            '  }',
            '}'
        ].join('\n');
    }
};

var generateGetNeighbourhood = function (neighbourhood) {
    var glsl = [
        'int getNeighbourhood (const in vec2 currentPos) {',
        '  int sum = 0;',
        ''
    ];

    for (var i = 0; i < neighbourhood.length; i++) {
        var neighbour = neighbourhood[i];
        glsl.push('  sum += getPixel(currentPos, vec2(' + printFloat(neighbour[0]) + ', ' + printFloat(neighbour[1]) + ')) > 0 ? 1 : 0;');
    }

    glsl.push('', '  return sum;', '}');

    return glsl.join('\n');
};

var generateGetNeighbourhoodCond = function (neighbourhood) {
    var glsl = [
        'int getNeighbourhoodCond (const in vec2 currentPos, const in int desiredValue) {',
        '  int sum = 0;',
        ''
    ];

    for (var i = 0; i < neighbourhood.length; i++) {
        var neighbour = neighbourhood[i];
        glsl.push('  sum += getPixel(currentPos, vec2(' + printFloat(neighbour[0]) + ', ' + printFloat(neighbour[1]) + ')) == desiredValue ? 1 : 0;');
    }

    glsl.push('', '  return sum;', '}');

    return glsl.join('\n');
};

var generateRandomFunction = function generateRandomFunction () {
    return [
        'float rand(vec2 co, float seed) {',
        '  co = co + vec2(fract(sin(dot(vec2(iFrame * 5.9898, seed * 78.5453), vec2(12.9898,78.233))) * 43758.5453));',
        '  return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);',
        '}'
    ].join('\n');
};

var generateEqualityCheck = function generateEqualityCheck (values, variable) {
    var checkString = [],
        groupedValues = [],
        previousValue = null,
        i;

    variable = variable || 'sum';

    if (values && values.length) {
        values.sort(function(a, b) {
            return a - b;
        });

        uniq(values, null, true);

        for (i = 0; i < values.length; i++) {
            if (previousValue === values[i] - 1) {
                groupedValues[groupedValues.length - 1].push(values[i]);
            } else {
                groupedValues.push([values[i]]);
            }

            previousValue = values[i];
        }

        for (i = 0; i < groupedValues.length; i++) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + variable + ' >= ' + groupedValues[i][0] + ' && ' + variable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ')');
            } else {
                checkString.push(variable + ' == ' + groupedValues[i][0]);
            }
        }
    } else {
        checkString.push('false');
    }

    return checkString.length > 1 ? '(' + checkString.join(' || ') + ')' : checkString[0];
};

var generateProbabilityCheck = function generateProbabilityCheck(probabilities, sumVariable, positionVariable) {
    var checkString = [],
        groupedValues = [],
        groupProbabilities = [],
        value = null,
        probability = null,
        previousValue = null,
        previousProbability = null,
        i;

    sumVariable = sumVariable || 'sum';
    positionVariable = positionVariable || 'position';

    for (i in probabilities) {
        value = parseInt(i, 10);
        probability = probabilities[i];

        if (previousValue === value - 1 && previousProbability === probability) {
            groupedValues[groupedValues.length - 1].push(value);
        } else {
            groupedValues.push([value]);
            groupProbabilities.push(probability);
        }

        previousValue = value;
        previousProbability = probability;
    }

    for (i = 0; i < groupProbabilities.length; i++) {
        probability = groupProbabilities[i];

        if (probability === 1) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + sumVariable + ' >= ' + groupedValues[i][0] + ' && ' + sumVariable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ')');
            } else {
                checkString.push(sumVariable + ' == ' + groupedValues[i][0]);
            }
        } else if (probability > 0) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + sumVariable + ' >= ' + groupedValues[i][0] + ' && ' + sumVariable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ' && rand(' + positionVariable + ', 1.) < ' + probability + ')');
            } else {
                checkString.push('(' + sumVariable + ' == ' + groupedValues[i][0] + ' && rand(' + positionVariable + ', 1.) < ' + probability + ')');
            }
        }
    }

    return checkString.length > 1 ? '(' + checkString.join(' || ') + ')' : checkString[0];
};

var generateProcessGlslGenerations = function generateProcessGlslGenerations (neighbourhood, stateCount, survival, birth) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhoodCond(position, 1);',
        '  if (currentValue == 0 && ' + generateEqualityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue == 1 && ' + generateEqualityCheck(survival) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0) {',
        '    return int(mod(float(currentValue + 1), ' + printFloat(stateCount) + '));',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslLife = function generateProcessGlslLife (neighbourhood, survival, birth) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && ' + generateEqualityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && ' + generateEqualityCheck(survival) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslStochastic = function generateProcessGlslStochastic (neighbourhood, survival, birth) {
    var glsl = [
        generateRandomFunction(),
        '',
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && ' + generateProbabilityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && ' + generateProbabilityCheck(survival) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslVote = function generateProcessGlslVote (neighbourhood, votes) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position) + (currentValue > 0 ? 1 : 0);',
        '  if (' + generateEqualityCheck(votes) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslLuky = function generateProcessGlslLuky (neighbourhood, lowSurvival, highSurvival, lowBirth, highBirth) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && sum >= ' + lowBirth + ' && sum <= ' + highBirth + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && sum >= ' + lowSurvival + ' && sum <= ' + highSurvival + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslNluky = function generateProcessGlslNluky (neighbourhood, stateCount, lowSurvival, highSurvival, lowBirth, highBirth) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhoodCond(position, 1);',
        '  if (currentValue == 0 && sum >= ' + lowBirth + ' && sum <= ' + highBirth + ') {',
        '    return 1;',
        '  } else if (currentValue == 1 && sum >= ' + lowSurvival + ' && sum <= ' + highSurvival + ') {',
        '    return 1;',
        '  } else if (currentValue == 1) {',
        '    return ' + (2 % (2 + stateCount * 2)) + ';',
        '  } else if (currentValue >= 2) {',
        '    return int(mod(float(currentValue + 2), ' + printFloat(2 + stateCount * 2) + '));',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslCyclic = function generateProcessGlslCyclic (neighbourhood, stateCount, threshold, greenbergHastingsModel) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int nextValue = int(mod(float(currentValue + 1), ' + printFloat(stateCount) + '));',
        '  int sum = getNeighbourhoodCond(position, nextValue);',
        '  if (sum >= ' + threshold + (greenbergHastingsModel ? ' || currentValue > 0' : '') + ') {',
        '    return nextValue;',
        '  }',
        '  return currentValue;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlsl = function generateProcessGlsl (neighbourhood, rule) {
    if (rule.ruleFormat === 'life' || rule.ruleFormat === 'extended-life') {
        return generateProcessGlslLife(neighbourhood, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'extended-stochastic') {
        return generateProcessGlslStochastic(neighbourhood, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'generations' || rule.ruleFormat === 'extended-generations') {
        return generateProcessGlslGenerations(neighbourhood, rule.stateCount, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'vote') {
        return generateProcessGlslVote(neighbourhood, rule.vote);
    } else if (rule.ruleFormat === 'luky') {
        return generateProcessGlslLuky(neighbourhood, rule.lowSurvival, rule.highSurvival, rule.lowBirth, rule.highBirth);
    } else if (rule.ruleFormat === 'nluky') {
        return generateProcessGlslNluky(neighbourhood, rule.stateCount, rule.lowSurvival, rule.highSurvival, rule.lowBirth, rule.highBirth);
    } else if (rule.ruleFormat === 'cyclic') {
        return generateProcessGlslCyclic(neighbourhood, rule.stateCount, rule.threshold, rule.greenbergHastingsModel);
    }

    throw new Error('Unsupported ruleFormat : ' + rule.ruleFormat);
};

var generateComment = function generateComment (what, rule, dimensions, outOfBoundValue) {
    var comments = [
        '/**',
        ' * ' + what + ' generated by cellular-automata-glsl 0.1.0',
        ' *',
        ' * Rule : ' + rule.ruleString,
        ' * Dimensions : ' + dimensions.length + 'D [' + dimensions.join(', ') + ']',
        ' * Out of bound value : ' + outOfBoundValue,
        ' */'
    ];

    return comments.join('\n');
};

var generateUniformsAndConstants = function generateUniformsAndConstants (dimensions) {
    return [
        'const vec2 iResolution = vec2(' + dimensions[0] + ', ' + dimensions[1] + ');',
        'uniform sampler2D iBackbuffer;',
        'uniform float iFrame;'
    ].join('\n');
};

module.exports = function generateShaders(rule, neighbourhood, dimensions, width, height, outOfBoundValue) {
    if (dimensions.length !== 2) {
        throw new Error('Does not support other dimension than 2D');
    }

    var fragmentGlsl = [
        generateComment('Fragment shader', rule, dimensions, outOfBoundValue),
        '',
        '#ifdef GL_ES',
        'precision highp float;',
        '#endif',
        '',
        generateUniformsAndConstants(dimensions),
        '',
        'int unpackValue(const in float packedValue) {',
        ' return int((packedValue * 255.) + 0.5);',
        '}',
        '',
        'float packValue(const in int unpackedValue) {',
        ' return float(unpackedValue) / 255.;',
        '}',
        '',
        generateGetPixelGlsl(outOfBoundValue),
        '',
        generateProcessGlsl(neighbourhood, rule),
        '',
        'void main() {',
        '  int currentValue = unpackValue(texture2D(iBackbuffer, gl_FragCoord.xy / iResolution).r);',
        '  gl_FragColor = vec4(packValue(process(currentValue, gl_FragCoord.xy)));',
        '}',
        ''
    ];

    var vertexGlsl = [
        generateComment('Vertex shader', rule, dimensions, outOfBoundValue),
        '',
        'attribute vec3 aVertexPosition;',
        'void main() {',
        '  gl_Position = vec4(aVertexPosition, 1.0);',
        '}',
        ''
    ];

    return {
        vertexShader: vertexGlsl.join('\n'),
        fragmentShader: fragmentGlsl.join('\n')
    };
};

},{"uniq":28}],3:[function(require,module,exports){
"use strict";

var uniq = require('uniq');

var printFloat = function printFloat (v) {
    return (v === v|0 ? v.toFixed(1) : v.toString(10));
};

var generateGetPosText = function generateGetPosText () {
    return [
        'vec2 getPosText(const in ivec3 position) {',
        '  float sposition = float(position.x + position.y * int(iStrideY) + position.z * int(iStrideZ));',
        '  return vec2(',
        '    mod(sposition, iTextureSize.x) / iTextureSize.x,',
        '    floor((sposition / iTextureSize.x)) / iTextureSize.x',
        '  );',
        '}'
    ].join('\n');
};

var generateGetPixelGlsl = function generateGetPixelGlsl (outOfBoundValue) {
    outOfBoundValue = outOfBoundValue || 0;

    if (outOfBoundValue === 'clamp') {
        return [
            'int getPixel(const in vec3 currentPos, const in vec3 add) {',
            '  ivec3 position = ivec3(clamp(currentPos + add, vec3(0.), iRealSize - vec3(1.)));',
            '  return unpackValue(texture2D(iBackbuffer, getPosText(position)).x);',
            '}'
        ].join('\n');
    } else if (outOfBoundValue === 'wrap') {
        return [
            'int getPixel(const in vec3 currentPos, const in vec3 add) {',
            '  ivec3 position = ivec3(mod(currentPos + add, iRealSize));',
            '  return unpackValue(texture2D(iBackbuffer, getPosText(position)).x);',
            '}'
        ].join('\n');
    } else {
        return [
            'int getPixel(const in vec3 currentPos, const in vec3 add) {',
            '  ivec3 position = ivec3(currentPos + add);',
            '  if(',
            '    position.x < 0 || position.x >= int(iRealSize.x) ||',
            '    position.y < 0 || position.y >= int(iRealSize.y) ||',
            '    position.z < 0 || position.z >= int(iRealSize.z)',
            '  ) {',
            '    return ' + outOfBoundValue + ';',
            '  } else {',
            '    return unpackValue(texture2D(iBackbuffer, getPosText(position)).x);',
            '  }',
            '}'
        ].join('\n');
    }
};

var generateGetNeighbourhood = function (neighbourhood) {
    var glsl = [
        'int getNeighbourhood (const in vec2 currentPos) {',
        '  float sposition = float(int(currentPos.x) + int(currentPos.y) * int(iTextureSize.x));',
        '  vec3 pixelPos = vec3(',
        '    mod(sposition, iRealSize.x),',
        '    mod(floor(sposition / iStrideY), iRealSize.y),',
        '    floor(sposition / iStrideZ)',
        '  );',
        '  int sum = 0;',
        ''
    ];

    for (var i = 0; i < neighbourhood.length; i++) {
        var neighbour = neighbourhood[i];
        glsl.push('  sum += getPixel(pixelPos, vec3(' + printFloat(neighbour[0]) + ', ' + printFloat(neighbour[1]) + ', ' + printFloat(neighbour[2]) + ')) > 0 ? 1 : 0;');
    }

    glsl.push('', '  return sum;', '}');

    return glsl.join('\n');
};

var generateGetNeighbourhoodCond = function (neighbourhood) {
    var glsl = [
        'int getNeighbourhoodCond (const in vec2 currentPos, const in int desiredValue) {',
        '  float sposition = float(int(currentPos.x) + int(currentPos.y) * int(iTextureSize.x));',
        '  vec3 pixelPos = vec3(',
        '    mod(sposition, iRealSize.x),',
        '    mod(floor(sposition / iStrideY), iRealSize.y),',
        '    floor(sposition / iStrideZ)',
        '  );',
        '  int sum = 0;',
        ''
    ];

    for (var i = 0; i < neighbourhood.length; i++) {
        var neighbour = neighbourhood[i];
        glsl.push('  sum += getPixel(pixelPos, vec3(' + printFloat(neighbour[0]) + ', ' + printFloat(neighbour[1]) + ', ' + printFloat(neighbour[2]) + ')) == desiredValue ? 1 : 0;');
    }

    glsl.push('', '  return sum;', '}');

    return glsl.join('\n');
};

var generateRandomFunction = function generateRandomFunction () {
    return [
        'float rand(vec3 co, float seed) {',
        '  co = co + vec3(fract(sin(dot(vec2(iFrame * 5.9898, seed * 78.5453), vec2(12.9898,78.233))) * 43758.5453));',
        '  return fract(sin(dot(co.xy + vec2(length(co.yz) * 24.0316), vec2(12.9898,78.233)) + dot(co.yz + vec2(length(co.zx) * 24.0316), vec2(12.9898,78.233)) + dot(co.zx + vec2(length(co.xy) * 24.0316), vec2(12.9898,78.233))) * 43758.5453);',
        '}'
    ].join('\n');
};

var generateEqualityCheck = function generateEqualityCheck (values, variable) {
    var checkString = [],
        groupedValues = [],
        previousValue = null,
        i;

    variable = variable || 'sum';

    if (values && values.length) {
        values.sort(function(a, b) {
            return a - b;
        });

        uniq(values, null, true);

        for (i = 0; i < values.length; i++) {
            if (previousValue === values[i] - 1) {
                groupedValues[groupedValues.length - 1].push(values[i]);
            } else {
                groupedValues.push([values[i]]);
            }

            previousValue = values[i];
        }

        for (i = 0; i < groupedValues.length; i++) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + variable + ' >= ' + groupedValues[i][0] + ' && ' + variable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ')');
            } else {
                checkString.push(variable + ' == ' + groupedValues[i][0]);
            }
        }
    } else {
        checkString.push('false');
    }

    return checkString.length > 1 ? '(' + checkString.join(' || ') + ')' : checkString[0];
};

var generateProbabilityCheck = function generateProbabilityCheck(probabilities, sumVariable, positionVariable) {
    var checkString = [],
        groupedValues = [],
        groupProbabilities = [],
        value = null,
        probability = null,
        previousValue = null,
        previousProbability = null,
        i;

    sumVariable = sumVariable || 'sum';
    positionVariable = positionVariable || 'position';

    for (i in probabilities) {
        value = parseInt(i, 10);
        probability = probabilities[i];

        if (previousValue === value - 1 && previousProbability === probability) {
            groupedValues[groupedValues.length - 1].push(value);
        } else {
            groupedValues.push([value]);
            groupProbabilities.push(probability);
        }

        previousValue = value;
        previousProbability = probability;
    }

    for (i = 0; i < groupProbabilities.length; i++) {
        probability = groupProbabilities[i];

        if (probability === 1) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + sumVariable + ' >= ' + groupedValues[i][0] + ' && ' + sumVariable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ')');
            } else {
                checkString.push(sumVariable + ' == ' + groupedValues[i][0]);
            }
        } else if (probability > 0) {
            if (groupedValues[i].length > 1) {
                checkString.push('(' + sumVariable + ' >= ' + groupedValues[i][0] + ' && ' + sumVariable + ' <= ' + groupedValues[i][groupedValues[i].length - 1] + ' && rand(' + positionVariable + ', 1.) < ' + probability + ')');
            } else {
                checkString.push('(' + sumVariable + ' == ' + groupedValues[i][0] + ' && rand(' + positionVariable + ', 1.) < ' + probability + ')');
            }
        }
    }

    return checkString.length > 1 ? '(' + checkString.join(' || ') + ')' : checkString[0];
};

var generateProcessGlslGenerations = function generateProcessGlslGenerations (neighbourhood, stateCount, survival, birth) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhoodCond(position, 1);',
        '  if (currentValue == 0 && ' + generateEqualityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue == 1 && ' + generateEqualityCheck(survival) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0) {',
        '    return int(mod(float(currentValue + 1), ' + printFloat(stateCount) + '));',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslLife = function generateProcessGlslLife (neighbourhood, survival, birth) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && ' + generateEqualityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && ' + generateEqualityCheck(survival) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslStochastic = function generateProcessGlslStochastic (neighbourhood, survival, birth) {
    var glsl = [
        generateRandomFunction(),
        '',
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec3 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && ' + generateProbabilityCheck(birth) + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && ' + generateProbabilityCheck(survival) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslVote = function generateProcessGlslVote (neighbourhood, votes) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position) + (currentValue > 0 ? 1 : 0);',
        '  if (' + generateEqualityCheck(votes) + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslLuky = function generateProcessGlslLuky (neighbourhood, lowSurvival, highSurvival, lowBirth, highBirth) {
    var glsl = [
        generateGetNeighbourhood(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhood(position);',
        '  if (currentValue == 0 && sum >= ' + lowBirth + ' && sum <= ' + highBirth + ') {',
        '    return 1;',
        '  } else if (currentValue > 0 && sum >= ' + lowSurvival + ' && sum <= ' + highSurvival + ') {',
        '    return 1;',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslNluky = function generateProcessGlslNluky (neighbourhood, stateCount, lowSurvival, highSurvival, lowBirth, highBirth) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int sum = getNeighbourhoodCond(position, 1);',
        '  if (currentValue == 0 && sum >= ' + lowBirth + ' && sum <= ' + highBirth + ') {',
        '    return 1;',
        '  } else if (currentValue == 1 && sum >= ' + lowSurvival + ' && sum <= ' + highSurvival + ') {',
        '    return 1;',
        '  } else if (currentValue == 1) {',
        '    return ' + (2 % (2 + stateCount * 2)) + ';',
        '  } else if (currentValue >= 2) {',
        '    return int(mod(float(currentValue + 2), ' + printFloat(2 + stateCount * 2) + '));',
        '  }',
        '  return 0;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlslCyclic = function generateProcessGlslCyclic (neighbourhood, stateCount, threshold, greenbergHastingsModel) {
    var glsl = [
        generateGetNeighbourhoodCond(neighbourhood),
        '',
        'int process(const in int currentValue, const in vec2 position) {',
        '  int nextValue = int(mod(float(currentValue + 1), ' + printFloat(stateCount) + '));',
        '  int sum = getNeighbourhoodCond(position, nextValue);',
        '  if (sum >= ' + threshold + (greenbergHastingsModel ? ' || currentValue > 0' : '') + ') {',
        '    return nextValue;',
        '  }',
        '  return currentValue;',
        '}'
    ];

    return glsl.join('\n');
};

var generateProcessGlsl = function generateProcessGlsl (neighbourhood,rule) {

    if (rule.ruleFormat === 'debug') {
        // debug process function
        var glsl = [
            'int process(const int currentValue, const vec2 position) {',
            '  float sposition = float(int(position.x) + int(position.y) * int(iTextureSize.x));',
            '  vec3 pixelPos = vec3(',
            '    mod(sposition, iRealSize.x),',
            '    mod(floor(sposition / iStrideY), iRealSize.y),',
            '    floor(sposition / iStrideZ)',
            '  );',
            '  return int(pixelPos.y);',
            '}'
        ];

        return glsl.join('\n');
    }


    if (rule.ruleFormat === 'life' || rule.ruleFormat === 'extended-life') {
        return generateProcessGlslLife(neighbourhood, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'extended-stochastic') {
        return generateProcessGlslStochastic(neighbourhood, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'generations' || rule.ruleFormat === 'extended-generations') {
        return generateProcessGlslGenerations(neighbourhood, rule.stateCount, rule.survival, rule.birth);
    } else if (rule.ruleFormat === 'vote') {
        return generateProcessGlslVote(neighbourhood, rule.vote);
    } else if (rule.ruleFormat === 'luky') {
        return generateProcessGlslLuky(neighbourhood, rule.lowSurvival, rule.highSurvival, rule.lowBirth, rule.highBirth);
    } else if (rule.ruleFormat === 'nluky') {
        return generateProcessGlslNluky(neighbourhood, rule.stateCount, rule.lowSurvival, rule.highSurvival, rule.lowBirth, rule.highBirth);
    } else if (rule.ruleFormat === 'cyclic') {
        return generateProcessGlslCyclic(neighbourhood, rule.stateCount, rule.threshold, rule.greenbergHastingsModel);
    }

    throw new Error('Unsupported ruleFormat : ' + rule.ruleFormat);
};

var generateComment = function generateComment (what, rule, dimensions, outOfBoundValue) {
    var comments = [
        '/**',
        ' * ' + what + ' generated by cellular-automata-glsl 0.1.0',
        ' *',
        ' * Rule : ' + rule.ruleString,
        ' * Dimensions : ' + dimensions.length + 'D [' + dimensions.join(', ') + ']',
        ' * Out of bound value : ' + outOfBoundValue,
        ' */'
    ];

    return comments.join('\n');
};

var generateUniformsAndConstants = function generateUniformsAndConstants (dimensions, textureWidth, textureHeight) {
    return [
        'const vec3 iRealSize = vec3(' + dimensions[0] + ', ' + dimensions[1] + ', ' + dimensions[2] + ');',
        'const vec2 iTextureSize = vec2(' + textureWidth + ', ' + textureHeight + ');',
        'const float iStrideY = ' + printFloat(dimensions[0]) + ';',
        'const float iStrideZ = ' + printFloat(dimensions[0] * dimensions[1]) + ';',
        'const float iMaxPos = ' + printFloat(dimensions[0] * dimensions[1] * dimensions[2]) + ';',
        'uniform sampler2D iBackbuffer;',
        'uniform float iFrame;'
    ].join('\n');
};

module.exports = function generateShaders(rule, neighbourhood, dimensions, width, height, outOfBoundValue) {
    if (dimensions.length !== 3) {
        throw new Error('Does not support other dimension than 3D');
    }

    var fragmentGlsl = [
        generateComment('Fragment shader', rule, dimensions, outOfBoundValue),
        '',
        '#ifdef GL_ES',
        '#if GL_FRAGMENT_PRECISION_HIGH == 1',
        '  precision highp float;',
        '  precision highp int;',
        '  precision highp sampler2D;',
        '#else',
        '  precision mediump float;',
        '  precision mediump int;',
        '  precision mediump sampler2D;',
        '#endif',
        '#endif',
        '',
        generateUniformsAndConstants(dimensions, width, height),
        '',
        'int unpackValue(const in float packedValue) {',
        ' return int((packedValue * 255.) + 0.5);',
        '}',
        '',
        'float packValue(const in int unpackedValue) {',
        ' return float(unpackedValue) / 255.;',
        '}',
        '',
        generateGetPosText(),
        '',
        generateGetPixelGlsl(outOfBoundValue),
        '',
        generateProcessGlsl(neighbourhood, rule),
        '',
        'void main() {',
        '  int currentValue = unpackValue(texture2D(iBackbuffer, gl_FragCoord.xy / iTextureSize).r);',
        '  gl_FragColor = vec4(packValue(process(currentValue, gl_FragCoord.xy)));',
        '}',
        ''
    ];

    var vertexGlsl = [
        generateComment('Vertex shader', rule, dimensions, outOfBoundValue),
        '',
        'attribute vec3 aVertexPosition;',
        'void main() {',
        '  gl_Position = vec4(aVertexPosition, 1.0);',
        '}',
        ''
    ];

    //console.log(fragmentGlsl.join('\n'));

    return {
        vertexShader: vertexGlsl.join('\n'),
        fragmentShader: fragmentGlsl.join('\n')
    };
};

},{"uniq":28}],4:[function(require,module,exports){
"use strict";

var getContext = require('./gl-context');

/**
 * Create the surface to draw onto
 * @param {WebGLRenderingContext} context
 * @returns {WebGLBuffer} Buffer of the surface
 */
var createBuffer = function createBuffer(context) {
    var triangleVertexPositionBuffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, triangleVertexPositionBuffer);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 4, 4, -1]), context.STATIC_DRAW);
    triangleVertexPositionBuffer.itemSize = 2;
    triangleVertexPositionBuffer.numItems = 3;

    return triangleVertexPositionBuffer;
};

/**
 * Create a target for rendering
 * @param {WebGLRenderingContext} context
 * @param {int} width
 * @param {int} height
 * @returns {{texture: WebGLTexture, framebuffer: WebGLFrameBuffer}}
 */
var createTarget = function createTarget(context, width, height) {
    var target = {
        texture : context.createTexture(),
        framebuffer : context.createFramebuffer()
    };

    context.bindTexture(context.TEXTURE_2D, target.texture);
    context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, width, height, 0, context.RGBA, context.UNSIGNED_BYTE, null);

    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);

    context.bindFramebuffer(context.FRAMEBUFFER, target.framebuffer);
    context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, target.texture, 0);

    context.bindTexture(context.TEXTURE_2D, null);
    context.bindFramebuffer(context.FRAMEBUFFER, null);

    return target;
};

/**
 * Create a shader
 * @param {WebGLRenderingContext} context
 * @param {int} type FRAGMENT_SHADER or VERTEX_SHADER
 * @param {string} src Source of the shader
 * @returns {WebGLShader}
 */
var createShader = function createShader(context, type, src) {
    var shader = context.createShader(type);
    context.shaderSource( shader, src );
    context.compileShader( shader );

    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
        throw new Error('Error creating shader : ' + context.getShaderInfoLog(shader) + '\n' + src);
    }

    return shader;
};

/**
 * Create a program
 * @param {WebGLRenderingContext} context
 * @param {{vertexShader:string, fragmentShader:string}} shaders
 * @returns {WebGLProgram}
 */
var createProgram = function createProgram(context, shaders) {
    var shaderProgram = context.createProgram(),
        vertexShader = createShader(context, context.VERTEX_SHADER, shaders.vertexShader),
        fragmentShader = createShader(context, context.FRAGMENT_SHADER, shaders.fragmentShader );

    context.attachShader(shaderProgram, vertexShader);
    context.attachShader(shaderProgram, fragmentShader);

    context.linkProgram(shaderProgram);

    if (!context.getProgramParameter(shaderProgram, context.LINK_STATUS)) {
        throw new Error('Could not initialise shaders');
    }

    shaderProgram.vertexPositionAttribute = context.getAttribLocation(shaderProgram, 'aVertexPosition');
    context.enableVertexAttribArray(shaderProgram.vertexPositionAttribute);
    shaderProgram.iBackbuffer = context.getUniformLocation(shaderProgram, 'iBackbuffer');
    shaderProgram.iFrame = context.getUniformLocation(shaderProgram, 'iFrame');

    return shaderProgram;
};

/**
 * Initialize a WebGL-based backend
 * @param {Array} shape
 * @constructor
 */
var GpuBackend = function GpuBackend (shape) {
    this.context = getContext(null, null, {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        preserveDrawingBuffer: false
    });

    this.context.gl.disable(this.context.gl.DEPTH_TEST);
    this.context.gl.disable(this.context.gl.DITHER);

    this.setShape(shape);
};

GpuBackend.prototype.shape = null;
GpuBackend.prototype.dimension = null;
GpuBackend.prototype.viewportWidth = null;
GpuBackend.prototype.viewportHeight = null;

GpuBackend.prototype.canvas = null;
GpuBackend.prototype.context = null;
GpuBackend.prototype.triangle = null;

GpuBackend.prototype.rgbaTextureData = null;
GpuBackend.prototype.frontTarget = null;
GpuBackend.prototype.backTarget = null;

/**
 * Set the shape
 * @param {Array} shape
 * @protected
 */
GpuBackend.prototype.setShape = function (shape) {
    var gl = this.context.gl;

    this.shape = shape;
    this.dimension = shape.length;

    if (this.dimension === 2) {
        this.viewportWidth = shape[0];
        this.viewportHeight = shape[1];
    } else if (this.dimension === 3) {
        //TODO it should be possible to optimize the total number of pixels using a rectangular texture instead of a square one
        this.viewportWidth = this.viewportHeight = Math.ceil(Math.sqrt(shape[0] * shape[1] * shape[2]));
    }

    this.context.resize(this.viewportWidth, this.viewportHeight);

    this.rgbaTextureData = new Uint8Array(this.viewportWidth * this.viewportHeight * 4);
    this.frontTarget = createTarget(gl, this.viewportWidth, this.viewportHeight);
    this.backTarget = createTarget(gl, this.viewportWidth, this.viewportHeight);
    this.triangle = createBuffer(gl);
};

/**
 * Execute a given rule for all its iterations
 * @param {object} rule
 * @public
 */
GpuBackend.prototype.execute = function (rule) {
    var shaders = rule.shaders,
        iteration = rule.iteration,
        gl = this.context.gl,
        shaderProgram = createProgram(gl, shaders);

    // set iteration-independent gl settings
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(shaderProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triangle);
    gl.vertexAttribPointer(shaderProgram.vertexPositionAttribute, this.triangle.itemSize, gl.FLOAT, false, 0, 0);
    gl.uniform1i(shaderProgram.iBackbuffer, 0);

    for (var i = 0; i < iteration; i++) {
        this.swapRenderingTargets();
        this.executeProgram(shaderProgram, i);
    }
};

/**
 * Swap the front and the back target
 * @protected
 */
GpuBackend.prototype.swapRenderingTargets = function () {
    var tmp = this.frontTarget;
    this.frontTarget = this.backTarget;
    this.backTarget = tmp;
};

/**
 * Execute a given WebGLProgram once
 * @param {WebGLProgram} shaderProgram
 * @param {int} iteration
 * @protected
 */
GpuBackend.prototype.executeProgram = function (shaderProgram, iteration) {
    var gl = this.context.gl;

    // set iFrame uniform
    gl.uniform1f(shaderProgram.iFrame, iteration);

    // set backbuffer
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backTarget.texture);

    // render to front buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontTarget.framebuffer);
    gl.drawArrays(gl.TRIANGLES, 0, this.triangle.numItems);
};

/**
 * Read the current state from the texture
 * @param {object} ndarray Instance of ndarray
 * @public
 */
GpuBackend.prototype.read = function (ndarray) {
    var gl = this.context.gl,
        data = this.rgbaTextureData,
        processedData = [],
        i,
        l,
        x,
        y,
        z;

    gl.readPixels(0, 0, this.viewportWidth, this.viewportHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);

    if (this.dimension === 2) {
        for(i = 0, l = data.length / 4; i < l; i++) {
            x = i % this.shape[0];
            y = Math.floor(i / this.shape[0]);

            ndarray.set(x, y, data[i * 4]);
        }
    } else {
        for(i = 0, l = data.length; i < l; i++) {
            x = i % this.shape[0];
            y = Math.floor(i / this.shape[0]) % this.shape[1];
            z = Math.floor(i / (this.shape[0] * this.shape[1]));

            if (z >= this.shape[2]) break;

            ndarray.set(x, y, z, data[i * 4]);

            /*
            if (data[i * 4]) {
                console.log(x, y, z, ndarray.get(x, y, z));
            }
            */
        }
    }

};

/**
 * Write the current state to the texture
 * @param {object} ndarray Instance of ndarray
 * @public
 */
GpuBackend.prototype.write = function (ndarray) {
    var shape = this.shape,
        data = this.rgbaTextureData,
        gl = this.context.gl,
        x,
        y,
        z,
        i;

    if (this.dimension === 2) {
        for (y = 0; y < shape[1]; y++) {
            for (x = 0; x < shape[0]; x++) {
                i = (x + y * shape[0]) * 4;

                data[i] = data[i + 1] = data[i + 2] = data[i + 3] = ndarray.get(x, y);
            }
        }
    } else {
        for (z = 0; z < shape[2]; z++) {
            for (y = 0; y < shape[1]; y++) {
                for (x = 0; x < shape[0]; x++) {
                    i = (x + (y * shape[0]) + (z * shape[0] * shape[1])) * 4;

                    data[i] = data[i + 1] = data[i + 2] = data[i + 3] = ndarray.get(x, y, z);
                    //console.log(data.length, i / 4, data[i]);
                }
            }
        }
    }

    //console.log(data);

    gl.bindTexture(gl.TEXTURE_2D, this.frontTarget.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.viewportWidth, this.viewportHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
};

module.exports = GpuBackend;

},{"./gl-context":5}],5:[function(require,module,exports){
(function (process){
"use strict";

var isNode = !!(typeof process !== 'undefined' && process.versions && process.versions.node),
    isWeb = !!(typeof window === 'object' && typeof document === 'object'),
    isWorker = !!(typeof WorkerGlobalScope !== 'undefined' && typeof self === 'object' && self instanceof WorkerGlobalScope),
    hasOffscreenCanvas = !!(typeof OffscreenCanvas !== 'undefined');

/**
 * Try to retrieve an headless WebGLRenderingContext
 * @param {int} width
 * @param {int} height
 * @param {object} glOptions
 * @returns {{canvas: *, gl: WebGLRenderingContext, resize: Function}} Object with canvas, gl context and standardized resize function.
 */
var getHeadlessGlContext = function getHeadlessGlContext (width, height, glOptions) {
    var context;

    try {
        context = require('gl')(width, height, glOptions);
    } catch (e) {
        throw new Error('Could not initialize headless WebGLRenderingContext : ' + e.message);
    }

    return {
        canvas: null,
        gl: context,
        resize: function (width, height) {
            this.gl.resize(width, height);
        }
    };
};

/**
 * Try to retrieve a WebGLRenderingContext from either a canvas DOMElement or an OffscreenCanvas
 * @param {int} width
 * @param {int} height
 * @param {object} glOptions
 * @returns {{canvas: *, gl: WebGLRenderingContext, resize: Function}} Object with canvas, gl context and standardized resize function.
 */
var getWebGlContext = function getWebGlContext (width, height, glOptions) {
    var canvas,
        context;

    try {
        if (isWeb) {
            canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
        } else if(hasOffscreenCanvas) {
            canvas = new OffscreenCanvas(width, height); //might crash in Firefox <= 45.x on Mac OS X
        }

        context = canvas.getContext('webgl2', glOptions) || canvas.getContext('webgl', glOptions) || canvas.getContext('experimental-webgl', glOptions);
    } catch (e) {
        throw new Error('Could not initialize WebGLRenderingContext : ' + e.message);
    }

    if (!context) {
        throw new Error('Could not initialize WebGLRenderingContext : not supported');
    }

    return {
        canvas: canvas,
        gl: context,
        resize: function (width, height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    };
};

/**
 * Retrieve an OpenGL context
 * @param {int} [width=64]
 * @param {int} [height=64]
 * @param {object} glOptions
 * @returns {{canvas: *, gl: WebGLRenderingContext, resize: Function}} Object with canvas, gl context and standardized resize function.
 */
var getContext = function getContext (width, height, glOptions) {
    width = width || 64;
    height = height || 64;

    if (isNode) {
        return getHeadlessGlContext(width, height, glOptions);
    } else if(isWeb || isWorker) {
        return getWebGlContext(width, height, glOptions);
    }
};

module.exports = getContext;

}).call(this,require('_process'))
},{"_process":30,"gl":undefined}],6:[function(require,module,exports){
"use strict";

var ndarray = require('ndarray');

var utils = {};

utils.createArray = function (shape, defaultValue) {
    var length = shape.reduce(function (p, v) { return p * v; }, 1),
        dataArray = new Uint8Array(length),
        i;

    for (i = 0; i < length; i++) {
        dataArray[i] = defaultValue;
    }

    return ndarray(dataArray, shape);
};

module.exports = utils;

},{"ndarray":22}],7:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^R([1-9][0-9]*)\/T([0-9]+)\/C([1-9][0-9]*)\/(NM|NN)(\/GH|)$/i;

//actually not the same as in life and generations
var getNeighbourMethod = function (methodId) {
    if (methodId === 'NN' || methodId === 'nn' || methodId === 'von-neumann') {
        return 'von-neumann';
    } else {
        return 'moore';
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'cyclic',
        ruleString: ruleString,
        threshold: parseInt(extractedRule[2], 10),
        stateCount: parseInt(extractedRule[3], 10),
        greenbergHastingsModel: (!!extractedRule[5]),
        neighbourhoodType: getNeighbourMethod(extractedRule[4]),
        neighbourhoodRange: parseInt(extractedRule[1], 10) || 1
    } : null;
};

var cyclicFunction = function (currentValue, neighbours) {
    var nextValue = (currentValue + 1) % this.stateCount,
        index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + (neighbours[index] === nextValue ? 1 : 0);
    }

    if (sum >= this.threshold || (this.greenbergHastingsModel && currentValue !== 0)) {
        result = nextValue;
    } else {
        result = currentValue;
    }

    return result;
};

var cyclic = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = cyclicFunction;
    }

    return ruleDescription;
};

module.exports = cyclic;

},{"../utils/utils":18}],8:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^ES?([0-9,.]*)\/B?([0-9,.]*)\/C?([1-9][0-9]*)(M|V|von-neumann|moore|axis|corner|edge|face|)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    methodId = methodId.toLowerCase();

    if (methodId === 'v') {
        return 'von-neumann';
    } else if (methodId === 'm' || methodId === ''){
        return 'moore';
    } else {
        return methodId;
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'extended-generations',
        ruleString: ruleString,
        survival: utils.splitCommaSeparatedNumbersWithRanges(extractedRule[1]),
        birth: utils.splitCommaSeparatedNumbersWithRanges(extractedRule[2]),
        stateCount: parseInt(extractedRule[3], 10) || 1,
        neighbourhoodType: getNeighbourMethod(extractedRule[4]),
        neighbourhoodRange: parseInt(extractedRule[5], 10) || 1
    } : null;
};

var extendedGenerationsFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + (neighbours[index] === 1 ? 1 : 0);
    }

    if (currentValue === 0 && this.birth.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue === 1 && this.survival.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue > 0) {
        result = (currentValue + 1) % this.stateCount;
    } else {
        result = 0;
    }

    return result;
};

var extendedGenerations = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = extendedGenerationsFunction;
    }

    return ruleDescription;
};

module.exports = extendedGenerations;

},{"../utils/utils":18}],9:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^ES?([0-9,.]*)\/B?([0-9,.]*)(M|V|von-neumann|moore|axis|corner|edge|face|)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    methodId = methodId.toLowerCase();

    if (methodId === 'v') {
        return 'von-neumann';
    } else if (methodId === 'm' || methodId === ''){
        return 'moore';
    } else {
        return methodId;
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'extended-life',
        ruleString: ruleString,
        survival: utils.splitCommaSeparatedNumbersWithRanges(extractedRule[1]),
        birth: utils.splitCommaSeparatedNumbersWithRanges(extractedRule[2]),
        neighbourhoodType: getNeighbourMethod(extractedRule[3]),
        neighbourhoodRange: parseInt(extractedRule[4], 10) || 1
    } : null;
};

var extendedLifeFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + neighbours[index];
    }

    if (currentValue === 0 && this.birth.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue === 1 && this.survival.indexOf(sum) > -1) {
        result = 1;
    } else {
        result = 0;
    }

    return result;
};

var extendedLife = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = extendedLifeFunction;
    }

    return ruleDescription;
};

module.exports = extendedLife;

},{"../utils/utils":18}],10:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^ES?([0-9,.:]*)\/B?([0-9,.:]*)(M|V|von-neumann|moore|axis|corner|edge|face|)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    methodId = methodId.toLowerCase();

    if (methodId === 'v') {
        return 'von-neumann';
    } else if (methodId === 'm' || methodId === ''){
        return 'moore';
    } else {
        return methodId;
    }
};

var regexRange = /([0-9]+)\.\.([0-9]+)/,
    regexProbability = /([0-9.]+):([0-9.]+)/;

var parseStochasticArgs = function (string) {
    //TODO refactor to utils along with splitCommaSeparatedNumbersWithRanges

    var splitString = string.split(','),
        result = {},
        expression,
        rangeMatch,
        probabilityMatch,
        probability,
        i = 0;

    for (; i < splitString.length; i++) {
        expression = splitString[i];
        rangeMatch = regexRange.exec(expression);
        probabilityMatch = regexProbability.exec(expression);

        probability = probabilityMatch ? parseFloat(probabilityMatch[2]) : 1;
        probability = Math.max(0, Math.min(1, probability));

        if (probability > 0 || isNaN(probability)) {
            if (rangeMatch) {
                utils.appendRangeToObjectWithProbability(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10), probability, result);
            } else {
                result[parseInt(expression, 10)] = probability;
            }
        }
    }

    return result;
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'extended-stochastic',
        ruleString: ruleString,
        survival: parseStochasticArgs(extractedRule[1]), //utils.splitCommaSeparatedNumbersWithRanges(extractedRule[1]),
        birth: parseStochasticArgs(extractedRule[2]), //utils.splitCommaSeparatedNumbersWithRanges(extractedRule[2]),
        neighbourhoodType: getNeighbourMethod(extractedRule[3]),
        neighbourhoodRange: parseInt(extractedRule[4], 10) || 1
    } : null;
};

var extendedStochasticFunction = function (currentValue, neighbours, rng) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    rng = rng || Math.random;

    for (; index < neighboursLength; index++) {
        sum = sum + neighbours[index];
    }

    if (currentValue === 0 && !!this.birth[sum]) {
        result = (this.birth[sum] === 1 || this.birth[sum] > rng()) ? 1 : 0;
    } else if (currentValue === 1 && !!this.survival[sum]) {
        result = (this.survival[sum] === 1 || this.survival[sum] > rng()) ? 1 : 0;
    } else {
        result = 0;
    }

    return result;
};

var extendedStochastic = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = extendedStochasticFunction;
    }

    return ruleDescription;
};

module.exports = extendedStochastic;

},{"../utils/utils":18}],11:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^S?([0-9]*)\/B?([0-9]*)\/C?([1-9][0-9]*)([MV]?)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    if (methodId === 'V' || methodId === 'v' || methodId === 'von-neumann') {
        return 'von-neumann';
    } else {
        return 'moore';
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'generations',
        ruleString: ruleString,
        survival: utils.splitStringInNumberArray(extractedRule[1]),
        birth: utils.splitStringInNumberArray(extractedRule[2]),
        stateCount: parseInt(extractedRule[3], 10) || 1,
        neighbourhoodType: getNeighbourMethod(extractedRule[4]),
        neighbourhoodRange: parseInt(extractedRule[5], 10) || 1
    } : null;
};

var generationsFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + (neighbours[index] === 1 ? 1 : 0);
    }

    if (currentValue === 0 && this.birth.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue === 1 && this.survival.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue > 0) {
        result = (currentValue + 1) % this.stateCount;
    } else {
        result = 0;
    }

    return result;
};

var generations = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = generationsFunction;
    }

    return ruleDescription;
};

module.exports = generations;

},{"../utils/utils":18}],12:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^S?([0-9]*)\/B?([0-9]*)([MV]?)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    if (methodId === 'V' || methodId === 'v' || methodId === 'von-neumann') {
        return 'von-neumann';
    } else {
        return 'moore';
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'life',
        ruleString: ruleString,
        survival: utils.splitStringInNumberArray(extractedRule[1]),
        birth: utils.splitStringInNumberArray(extractedRule[2]),
        neighbourhoodType: getNeighbourMethod(extractedRule[3]),
        neighbourhoodRange: parseInt(extractedRule[4], 10) || 1
    } : null;
};

var lifeFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + neighbours[index];
    }

    if (currentValue === 0 && this.birth.indexOf(sum) > -1) {
        result = 1;
    } else if (currentValue === 1 && this.survival.indexOf(sum) > -1) {
        result = 1;
    } else {
        result = 0;
    }

    return result;
};

var life = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = lifeFunction;
    }

    return ruleDescription;
};

module.exports = life;

},{"../utils/utils":18}],13:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^LUKY([0-9])([0-9])([0-9])([0-9])$/i;

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'luky',
        ruleString: ruleString,
        lowBirth: parseInt(extractedRule[1], 10),
        highBirth: parseInt(extractedRule[2], 10),
        lowSurvival: parseInt(extractedRule[3], 10),
        highSurvival: parseInt(extractedRule[4], 10),
        neighbourhoodType: 'moore',
        neighbourhoodRange: 1
    } : null;
};

var lukyFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + (neighbours[index] === 1 ? 1 : 0);
    }

    if (currentValue === 0 && sum >= this.lowBirth && sum <= this.highBirth) {
        result = 1;
    } else if (currentValue === 1 && sum >= this.lowSurvival && sum <= this.highSurvival) {
        result = 1;
    } else {
        result = 0;
    }

    return result;
};

var generations = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = lukyFunction;
    }

    return ruleDescription;
};

module.exports = generations;

},{"../utils/utils":18}],14:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^NLUKY([0-9])([0-9])([0-9])([0-9])([0-9])$/i;

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'nluky',
        ruleString: ruleString,
        stateCount: parseInt(extractedRule[1], 10),
        lowBirth: parseInt(extractedRule[2], 10),
        highBirth: parseInt(extractedRule[3], 10),
        lowSurvival: parseInt(extractedRule[4], 10),
        highSurvival: parseInt(extractedRule[5], 10),
        neighbourhoodType: 'moore',
        neighbourhoodRange: 1
    } : null;
};

var nlukyFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = 0,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + (neighbours[index] === 1 ? 1 : 0);
    }

    if (currentValue === 0 && sum >= this.lowBirth && sum <= this.highBirth) {
        result = 1;
    } else if (currentValue === 1 && sum >= this.lowSurvival && sum <= this.highSurvival) {
        result = 1;
    } else if (currentValue === 1) {
        result = 2 % (2 + this.stateCount * 2);
    } else if (currentValue >= 2) {
        result = (currentValue + 2) % (2 + this.stateCount * 2);
    } else {
        result = 0;
    }

    return result;
};

var generations = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = nlukyFunction;
    }

    return ruleDescription;
};

module.exports = generations;

},{"../utils/utils":18}],15:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^([0-9]+)([MV]?)([0-9]*)$/i;

var getNeighbourMethod = function (methodId) {
    if (methodId === 'V' || methodId === 'v' || methodId === 'von-neumann') {
        return 'von-neumann';
    } else {
        return 'moore';
    }
};

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString));

    return extractedRule ? {
        ruleFormat: 'vote',
        ruleString: ruleString,
        vote: utils.splitStringInNumberArray(extractedRule[1]),
        neighbourhoodType: getNeighbourMethod(extractedRule[2]),
        neighbourhoodRange: parseInt(extractedRule[3], 10) || 1
    } : null;
};

var voteFunction = function (currentValue, neighbours) {
    var index = 0,
        sum = currentValue,
        neighboursLength = neighbours.length,
        result;

    for (; index < neighboursLength; index++) {
        sum = sum + neighbours[index];
    }

    if (this.vote.indexOf(sum) > -1) {
        result = 1;
    } else {
        result = 0;
    }

    return result;
};

var vote = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = voteFunction;
    }

    return ruleDescription;
};

module.exports = vote;

},{"../utils/utils":18}],16:[function(require,module,exports){
"use strict";

var utils = require('../utils/utils'),
    ruleRegexp = /^(W|Rule)([0-9]{1,3})$/i;

var parseRuleString = function (ruleString) {
    var extractedRule = ruleRegexp.exec(utils.stripWhitespaces(ruleString)),
        ruleNumber = extractedRule ? parseInt(extractedRule[2], 10) : null;

    return extractedRule && ruleNumber >= 0 && ruleNumber <= 255 ? {
        ruleFormat: 'wolfram',
        ruleString: ruleString,
        ruleNumber: ruleNumber,
        neighbourhoodType: 'von-neumann',
        neighbourhoodRange: 1
    } : null;
};

var wolframFunction = function (currentValue, neighbours) {
    var binaryState = (neighbours[0] ? 4 : 0) + (currentValue ? 2 : 0) + (neighbours[1] ? 1 : 0);

    return (this.ruleNumber & Math.pow(2, binaryState) ? 1 : 0);
};

var wolfram = function (rule) {
    var ruleDescription = parseRuleString(rule);

    if (ruleDescription !== null) {
        ruleDescription.process = wolframFunction;
    }

    return ruleDescription;
};

module.exports = wolfram;

},{"../utils/utils":18}],17:[function(require,module,exports){
"use strict";

var formats = {
    life: require('./formats/life'),
    extendedLife: require('./formats/extendedLife'),
    extendedStochastic: require('./formats/extendedStochastic'),
    generations: require('./formats/generations'),
    extendedGenerations: require('./formats/extendedGenerations'),
    cyclic: require('./formats/cyclic'),
    vote: require('./formats/vote'),
    wolfram: require('./formats/wolfram'),
    luky: require('./formats/luky'),
    nluky: require('./formats/nluky')
};

var parser = function parser (ruleString, format) {
    var result = null;

    if (typeof ruleString === 'string') {
        if (!!format) {
            result = !!formats[format] ? formats[format](ruleString) : null;
        } else {
            for (format in formats) {
                if (formats.hasOwnProperty(format)) {
                    result = formats[format](ruleString);

                    if (result !== null) {
                        break;
                    }
                }
            }
        }
    }

    return result;
};

module.exports = parser;

},{"./formats/cyclic":7,"./formats/extendedGenerations":8,"./formats/extendedLife":9,"./formats/extendedStochastic":10,"./formats/generations":11,"./formats/life":12,"./formats/luky":13,"./formats/nluky":14,"./formats/vote":15,"./formats/wolfram":16}],18:[function(require,module,exports){
"use strict";

var utils = {};

utils.stripWhitespaces = function (string) {
    return string.replace(/\s/g, '');
};

utils.splitStringInNumberArray = function (string) {
    return string.split('').map(function (value) {
        return parseInt(value, 10);
    });
};

var regexRange = /([0-9]+)\.\.([0-9]+)/;

utils.splitCommaSeparatedNumbersWithRanges = function (string) {
    var splitString = string.split(','),
        result = [],
        expression,
        rangeMatch,
        i = 0;

    for (; i < splitString.length; i++) {
        expression = splitString[i];
        rangeMatch = regexRange.exec(expression);

        if (rangeMatch) {
            utils.appendRangeToArray(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10), result);
        } else {
            result.push(parseInt(expression, 10));
        }
    }

    return result.filter(function (v) {
        return !isNaN(v);
    });
};

utils.appendRangeToArray = function (min, max, array) {
    var tmp;

    if (min > max) {
        tmp = max;
        max = min;
        min = tmp;
    }

    for (; min <= max; min++) {
        array.push(min);
    }
};

utils.appendRangeToObjectWithProbability = function (min, max, probability, object) {
    var tmp;

    if (min > max) {
        tmp = max;
        max = min;
        min = tmp;
    }

    for (; min <= max; min++) {
        object[min] = probability;
    }
};

module.exports = utils;

},{}],19:[function(require,module,exports){
"use strict"

function iota(n) {
  var result = new Array(n)
  for(var i=0; i<n; ++i) {
    result[i] = i
  }
  return result
}

module.exports = iota
},{}],20:[function(require,module,exports){
/*!
 * Determine if an object is a Buffer
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

// The _isBuffer check is for Safari 5-7 support, because it's missing
// Object.prototype.constructor. Remove this eventually
module.exports = function (obj) {
  return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
}

function isBuffer (obj) {
  return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
}

// For Node v0.10 support. Remove this eventually.
function isSlowBuffer (obj) {
  return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
}

},{}],21:[function(require,module,exports){
module.exports = moore

function moore(range, dims) {
  dims = dims || 2
  range = range || 1
  return recurse([], [], 0)

  function recurse(array, temp, d) {
    if (d === dims-1) {
      for (var i = -range; i <= range; i += 1) {
        if (i || temp.some(function(n) {
          return n
        })) array.push(temp.concat(i))
      }
    } else {
      for (var i = -range; i <= range; i += 1) {
        recurse(array, temp.concat(i), d+1)
      }
    }
    return array
  }
}

},{}],22:[function(require,module,exports){
var iota = require("iota-array")
var isBuffer = require("is-buffer")

var hasTypedArrays  = ((typeof Float64Array) !== "undefined")

function compare1st(a, b) {
  return a[0] - b[0]
}

function order() {
  var stride = this.stride
  var terms = new Array(stride.length)
  var i
  for(i=0; i<terms.length; ++i) {
    terms[i] = [Math.abs(stride[i]), i]
  }
  terms.sort(compare1st)
  var result = new Array(terms.length)
  for(i=0; i<result.length; ++i) {
    result[i] = terms[i][1]
  }
  return result
}

function compileConstructor(dtype, dimension) {
  var className = ["View", dimension, "d", dtype].join("")
  if(dimension < 0) {
    className = "View_Nil" + dtype
  }
  var useGetters = (dtype === "generic")

  if(dimension === -1) {
    //Special case for trivial arrays
    var code =
      "function "+className+"(a){this.data=a;};\
var proto="+className+".prototype;\
proto.dtype='"+dtype+"';\
proto.index=function(){return -1};\
proto.size=0;\
proto.dimension=-1;\
proto.shape=proto.stride=proto.order=[];\
proto.lo=proto.hi=proto.transpose=proto.step=\
function(){return new "+className+"(this.data);};\
proto.get=proto.set=function(){};\
proto.pick=function(){return null};\
return function construct_"+className+"(a){return new "+className+"(a);}"
    var procedure = new Function(code)
    return procedure()
  } else if(dimension === 0) {
    //Special case for 0d arrays
    var code =
      "function "+className+"(a,d) {\
this.data = a;\
this.offset = d\
};\
var proto="+className+".prototype;\
proto.dtype='"+dtype+"';\
proto.index=function(){return this.offset};\
proto.dimension=0;\
proto.size=1;\
proto.shape=\
proto.stride=\
proto.order=[];\
proto.lo=\
proto.hi=\
proto.transpose=\
proto.step=function "+className+"_copy() {\
return new "+className+"(this.data,this.offset)\
};\
proto.pick=function "+className+"_pick(){\
return TrivialArray(this.data);\
};\
proto.valueOf=proto.get=function "+className+"_get(){\
return "+(useGetters ? "this.data.get(this.offset)" : "this.data[this.offset]")+
"};\
proto.set=function "+className+"_set(v){\
return "+(useGetters ? "this.data.set(this.offset,v)" : "this.data[this.offset]=v")+"\
};\
return function construct_"+className+"(a,b,c,d){return new "+className+"(a,d)}"
    var procedure = new Function("TrivialArray", code)
    return procedure(CACHED_CONSTRUCTORS[dtype][0])
  }

  var code = ["'use strict'"]

  //Create constructor for view
  var indices = iota(dimension)
  var args = indices.map(function(i) { return "i"+i })
  var index_str = "this.offset+" + indices.map(function(i) {
        return "this.stride[" + i + "]*i" + i
      }).join("+")
  var shapeArg = indices.map(function(i) {
      return "b"+i
    }).join(",")
  var strideArg = indices.map(function(i) {
      return "c"+i
    }).join(",")
  code.push(
    "function "+className+"(a," + shapeArg + "," + strideArg + ",d){this.data=a",
      "this.shape=[" + shapeArg + "]",
      "this.stride=[" + strideArg + "]",
      "this.offset=d|0}",
    "var proto="+className+".prototype",
    "proto.dtype='"+dtype+"'",
    "proto.dimension="+dimension)

  //view.size:
  code.push("Object.defineProperty(proto,'size',{get:function "+className+"_size(){\
return "+indices.map(function(i) { return "this.shape["+i+"]" }).join("*"),
"}})")

  //view.order:
  if(dimension === 1) {
    code.push("proto.order=[0]")
  } else {
    code.push("Object.defineProperty(proto,'order',{get:")
    if(dimension < 4) {
      code.push("function "+className+"_order(){")
      if(dimension === 2) {
        code.push("return (Math.abs(this.stride[0])>Math.abs(this.stride[1]))?[1,0]:[0,1]}})")
      } else if(dimension === 3) {
        code.push(
"var s0=Math.abs(this.stride[0]),s1=Math.abs(this.stride[1]),s2=Math.abs(this.stride[2]);\
if(s0>s1){\
if(s1>s2){\
return [2,1,0];\
}else if(s0>s2){\
return [1,2,0];\
}else{\
return [1,0,2];\
}\
}else if(s0>s2){\
return [2,0,1];\
}else if(s2>s1){\
return [0,1,2];\
}else{\
return [0,2,1];\
}}})")
      }
    } else {
      code.push("ORDER})")
    }
  }

  //view.set(i0, ..., v):
  code.push(
"proto.set=function "+className+"_set("+args.join(",")+",v){")
  if(useGetters) {
    code.push("return this.data.set("+index_str+",v)}")
  } else {
    code.push("return this.data["+index_str+"]=v}")
  }

  //view.get(i0, ...):
  code.push("proto.get=function "+className+"_get("+args.join(",")+"){")
  if(useGetters) {
    code.push("return this.data.get("+index_str+")}")
  } else {
    code.push("return this.data["+index_str+"]}")
  }

  //view.index:
  code.push(
    "proto.index=function "+className+"_index(", args.join(), "){return "+index_str+"}")

  //view.hi():
  code.push("proto.hi=function "+className+"_hi("+args.join(",")+"){return new "+className+"(this.data,"+
    indices.map(function(i) {
      return ["(typeof i",i,"!=='number'||i",i,"<0)?this.shape[", i, "]:i", i,"|0"].join("")
    }).join(",")+","+
    indices.map(function(i) {
      return "this.stride["+i + "]"
    }).join(",")+",this.offset)}")

  //view.lo():
  var a_vars = indices.map(function(i) { return "a"+i+"=this.shape["+i+"]" })
  var c_vars = indices.map(function(i) { return "c"+i+"=this.stride["+i+"]" })
  code.push("proto.lo=function "+className+"_lo("+args.join(",")+"){var b=this.offset,d=0,"+a_vars.join(",")+","+c_vars.join(","))
  for(var i=0; i<dimension; ++i) {
    code.push(
"if(typeof i"+i+"==='number'&&i"+i+">=0){\
d=i"+i+"|0;\
b+=c"+i+"*d;\
a"+i+"-=d}")
  }
  code.push("return new "+className+"(this.data,"+
    indices.map(function(i) {
      return "a"+i
    }).join(",")+","+
    indices.map(function(i) {
      return "c"+i
    }).join(",")+",b)}")

  //view.step():
  code.push("proto.step=function "+className+"_step("+args.join(",")+"){var "+
    indices.map(function(i) {
      return "a"+i+"=this.shape["+i+"]"
    }).join(",")+","+
    indices.map(function(i) {
      return "b"+i+"=this.stride["+i+"]"
    }).join(",")+",c=this.offset,d=0,ceil=Math.ceil")
  for(var i=0; i<dimension; ++i) {
    code.push(
"if(typeof i"+i+"==='number'){\
d=i"+i+"|0;\
if(d<0){\
c+=b"+i+"*(a"+i+"-1);\
a"+i+"=ceil(-a"+i+"/d)\
}else{\
a"+i+"=ceil(a"+i+"/d)\
}\
b"+i+"*=d\
}")
  }
  code.push("return new "+className+"(this.data,"+
    indices.map(function(i) {
      return "a" + i
    }).join(",")+","+
    indices.map(function(i) {
      return "b" + i
    }).join(",")+",c)}")

  //view.transpose():
  var tShape = new Array(dimension)
  var tStride = new Array(dimension)
  for(var i=0; i<dimension; ++i) {
    tShape[i] = "a[i"+i+"]"
    tStride[i] = "b[i"+i+"]"
  }
  code.push("proto.transpose=function "+className+"_transpose("+args+"){"+
    args.map(function(n,idx) { return n + "=(" + n + "===undefined?" + idx + ":" + n + "|0)"}).join(";"),
    "var a=this.shape,b=this.stride;return new "+className+"(this.data,"+tShape.join(",")+","+tStride.join(",")+",this.offset)}")

  //view.pick():
  code.push("proto.pick=function "+className+"_pick("+args+"){var a=[],b=[],c=this.offset")
  for(var i=0; i<dimension; ++i) {
    code.push("if(typeof i"+i+"==='number'&&i"+i+">=0){c=(c+this.stride["+i+"]*i"+i+")|0}else{a.push(this.shape["+i+"]);b.push(this.stride["+i+"])}")
  }
  code.push("var ctor=CTOR_LIST[a.length+1];return ctor(this.data,a,b,c)}")

  //Add return statement
  code.push("return function construct_"+className+"(data,shape,stride,offset){return new "+className+"(data,"+
    indices.map(function(i) {
      return "shape["+i+"]"
    }).join(",")+","+
    indices.map(function(i) {
      return "stride["+i+"]"
    }).join(",")+",offset)}")

  //Compile procedure
  var procedure = new Function("CTOR_LIST", "ORDER", code.join("\n"))
  return procedure(CACHED_CONSTRUCTORS[dtype], order)
}

function arrayDType(data) {
  if(isBuffer(data)) {
    return "buffer"
  }
  if(hasTypedArrays) {
    switch(Object.prototype.toString.call(data)) {
      case "[object Float64Array]":
        return "float64"
      case "[object Float32Array]":
        return "float32"
      case "[object Int8Array]":
        return "int8"
      case "[object Int16Array]":
        return "int16"
      case "[object Int32Array]":
        return "int32"
      case "[object Uint8Array]":
        return "uint8"
      case "[object Uint16Array]":
        return "uint16"
      case "[object Uint32Array]":
        return "uint32"
      case "[object Uint8ClampedArray]":
        return "uint8_clamped"
    }
  }
  if(Array.isArray(data)) {
    return "array"
  }
  return "generic"
}

var CACHED_CONSTRUCTORS = {
  "float32":[],
  "float64":[],
  "int8":[],
  "int16":[],
  "int32":[],
  "uint8":[],
  "uint16":[],
  "uint32":[],
  "array":[],
  "uint8_clamped":[],
  "buffer":[],
  "generic":[]
}

;(function() {
  for(var id in CACHED_CONSTRUCTORS) {
    CACHED_CONSTRUCTORS[id].push(compileConstructor(id, -1))
  }
});

function wrappedNDArrayCtor(data, shape, stride, offset) {
  if(data === undefined) {
    var ctor = CACHED_CONSTRUCTORS.array[0]
    return ctor([])
  } else if(typeof data === "number") {
    data = [data]
  }
  if(shape === undefined) {
    shape = [ data.length ]
  }
  var d = shape.length
  if(stride === undefined) {
    stride = new Array(d)
    for(var i=d-1, sz=1; i>=0; --i) {
      stride[i] = sz
      sz *= shape[i]
    }
  }
  if(offset === undefined) {
    offset = 0
    for(var i=0; i<d; ++i) {
      if(stride[i] < 0) {
        offset -= (shape[i]-1)*stride[i]
      }
    }
  }
  var dtype = arrayDType(data)
  var ctor_list = CACHED_CONSTRUCTORS[dtype]
  while(ctor_list.length <= d+1) {
    ctor_list.push(compileConstructor(dtype, ctor_list.length-1))
  }
  var ctor = ctor_list[d+1]
  return ctor(data, shape, stride, offset)
}

module.exports = wrappedNDArrayCtor

},{"iota-array":19,"is-buffer":20}],23:[function(require,module,exports){
module.exports = function axis (range, dims) {
    "use strict";

    dims = dims || 2;
    range = range || 1;

    return recurse([], [], 0);

    function recurse (array, temp, d) {
        var i,
            k,
            match;

        if (d === dims-1) {
            for (i = -range; i <= range; i += 1) {
                match = (i === 0 ? 1 : 0);
                for (k = 0; k < dims; k++) {
                    match+= (temp[k] === 0 ? 1 : 0);
                }

                if (match === dims-1) {
                    array.push(temp.concat(i));
                }
            }
        } else {
            for (i = -range; i <= range; i += 1) {
                recurse(array, temp.concat(i), d + 1);
            }
        }

        return array;
    }
};

},{}],24:[function(require,module,exports){
module.exports = function corner (range, dims) {
    "use strict";

    dims = dims || 2;
    range = range || 1;

    return recurse([], [], 0);

    function recurse (array, temp, d) {
        var i,
            k,
            match;

        if (d === dims-1) {
            for (i = -range; i <= range; i += 1) {
                match = (Math.abs(i) === range ? 1 : 0);
                for (k = 0; k < dims; k++) {
                    match += (Math.abs(temp[k]) === range ? 1 : 0);
                }

                if (match === dims) {
                    array.push(temp.concat(i));
                }
            }
        } else {
            for (i = -range; i <= range; i += 1) {
                recurse(array, temp.concat(i), d + 1);
            }
        }

        return array;
    }
};

},{}],25:[function(require,module,exports){
module.exports = function edge (range, dims) {
    "use strict";

    dims = dims || 2;
    range = range || 1;

    return recurse([], [], 0);

    function recurse (array, temp, d) {
        var i,
            k,
            match;

        if (d === dims-1) {
            for (i = -range; i <= range; i += 1) {
                match = (Math.abs(i) === range ? 1 : 0);
                for (k = 0; k < dims; k++) {
                    match += (Math.abs(temp[k]) === range ? 1 : 0);
                }

                if (match >= dims - 1) {
                    array.push(temp.concat(i));
                }
            }
        } else {
            for (i = -range; i <= range; i += 1) {
                recurse(array, temp.concat(i), d + 1);
            }
        }

        return array;
    }
};

},{}],26:[function(require,module,exports){
module.exports = function face (range, dims) {
    "use strict";

    dims = dims || 2;
    range = range || 1;

    return recurse([], [], 0);

    function recurse (array, temp, d) {
        var i,
            k,
            match;

        if (d === dims-1) {
            for (i = -range; i <= range; i += 1) {
                match = (Math.abs(i) === range);
                for (k = 0; !match && k < dims; k++) {
                    match = (Math.abs(temp[k]) === range);
                }

                if (match) {
                    array.push(temp.concat(i));
                }
            }
        } else {
            for (i = -range; i <= range; i += 1) {
                recurse(array, temp.concat(i), d + 1);
            }
        }

        return array;
    }
};

},{}],27:[function(require,module,exports){
module.exports = {
    axis: require('./functions/axis'),
    corner: require('./functions/corner'),
    edge: require('./functions/edge'),
    face: require('./functions/face')
};

},{"./functions/axis":23,"./functions/corner":24,"./functions/edge":25,"./functions/face":26}],28:[function(require,module,exports){
"use strict"

function unique_pred(list, compare) {
  var ptr = 1
    , len = list.length
    , a=list[0], b=list[0]
  for(var i=1; i<len; ++i) {
    b = a
    a = list[i]
    if(compare(a, b)) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique_eq(list) {
  var ptr = 1
    , len = list.length
    , a=list[0], b = list[0]
  for(var i=1; i<len; ++i, b=a) {
    b = a
    a = list[i]
    if(a !== b) {
      if(i === ptr) {
        ptr++
        continue
      }
      list[ptr++] = a
    }
  }
  list.length = ptr
  return list
}

function unique(list, compare, sorted) {
  if(list.length === 0) {
    return list
  }
  if(compare) {
    if(!sorted) {
      list.sort(compare)
    }
    return unique_pred(list, compare)
  }
  if(!sorted) {
    list.sort()
  }
  return unique_eq(list)
}

module.exports = unique

},{}],29:[function(require,module,exports){
module.exports = vonNeumann;

function vonNeumann(range, dims) {
    dims = dims || 2;
    range = range || 1;
    return recurse([], [], 0);

    function recurse(array, temp, d) {
        var manhattanDistance,
            i;

        if (d === dims-1) {
            for (i = -range; i <= range; i += 1) {
                manhattanDistance = temp.reduce(function (sum, value) { return sum + Math.abs(value); }, Math.abs(i));

                if (manhattanDistance <= range && manhattanDistance !== 0) {
                    array.push(temp.concat(i));
                }
            }
        } else {
            for (i = -range; i <= range; i += 1) {
                recurse(array, temp.concat(i), d + 1);
            }
        }

        return array;
    }
}

},{}],30:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canMutationObserver = typeof window !== 'undefined'
    && window.MutationObserver;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    var queue = [];

    if (canMutationObserver) {
        var hiddenDiv = document.createElement("div");
        var observer = new MutationObserver(function () {
            var queueList = queue.slice();
            queue.length = 0;
            queueList.forEach(function (fn) {
                fn();
            });
        });

        observer.observe(hiddenDiv, { attributes: true });

        return function nextTick(fn) {
            if (!queue.length) {
                hiddenDiv.setAttribute('yes', 'no');
            }
            queue.push(fn);
        };
    }

    if (canPost) {
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsImluZGV4LmpzIiwibGliL2NlbGx1bGFyLWF1dG9tYXRhLWdsc2wtMmQuanMiLCJsaWIvY2VsbHVsYXItYXV0b21hdGEtZ2xzbC0zZC5qcyIsImxpYi9jZWxsdWxhci1hdXRvbWF0YS1ncHUtYmFja2VuZC5qcyIsImxpYi9nbC1jb250ZXh0LmpzIiwibGliL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyL2Zvcm1hdHMvY3ljbGljLmpzIiwibm9kZV9tb2R1bGVzL2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyL2Zvcm1hdHMvZXh0ZW5kZWRHZW5lcmF0aW9ucy5qcyIsIm5vZGVfbW9kdWxlcy9jZWxsdWxhci1hdXRvbWF0YS1ydWxlLXBhcnNlci9mb3JtYXRzL2V4dGVuZGVkTGlmZS5qcyIsIm5vZGVfbW9kdWxlcy9jZWxsdWxhci1hdXRvbWF0YS1ydWxlLXBhcnNlci9mb3JtYXRzL2V4dGVuZGVkU3RvY2hhc3RpYy5qcyIsIm5vZGVfbW9kdWxlcy9jZWxsdWxhci1hdXRvbWF0YS1ydWxlLXBhcnNlci9mb3JtYXRzL2dlbmVyYXRpb25zLmpzIiwibm9kZV9tb2R1bGVzL2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyL2Zvcm1hdHMvbGlmZS5qcyIsIm5vZGVfbW9kdWxlcy9jZWxsdWxhci1hdXRvbWF0YS1ydWxlLXBhcnNlci9mb3JtYXRzL2x1a3kuanMiLCJub2RlX21vZHVsZXMvY2VsbHVsYXItYXV0b21hdGEtcnVsZS1wYXJzZXIvZm9ybWF0cy9ubHVreS5qcyIsIm5vZGVfbW9kdWxlcy9jZWxsdWxhci1hdXRvbWF0YS1ydWxlLXBhcnNlci9mb3JtYXRzL3ZvdGUuanMiLCJub2RlX21vZHVsZXMvY2VsbHVsYXItYXV0b21hdGEtcnVsZS1wYXJzZXIvZm9ybWF0cy93b2xmcmFtLmpzIiwibm9kZV9tb2R1bGVzL2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyL3V0aWxzL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL2lvdGEtYXJyYXkvaW90YS5qcyIsIm5vZGVfbW9kdWxlcy9pcy1idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbW9vcmUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvbmRhcnJheS9uZGFycmF5LmpzIiwibm9kZV9tb2R1bGVzL3VuY29udmVudGlvbmFsLW5laWdoYm91cnMvZnVuY3Rpb25zL2F4aXMuanMiLCJub2RlX21vZHVsZXMvdW5jb252ZW50aW9uYWwtbmVpZ2hib3Vycy9mdW5jdGlvbnMvY29ybmVyLmpzIiwibm9kZV9tb2R1bGVzL3VuY29udmVudGlvbmFsLW5laWdoYm91cnMvZnVuY3Rpb25zL2VkZ2UuanMiLCJub2RlX21vZHVsZXMvdW5jb252ZW50aW9uYWwtbmVpZ2hib3Vycy9mdW5jdGlvbnMvZmFjZS5qcyIsIm5vZGVfbW9kdWxlcy91bmNvbnZlbnRpb25hbC1uZWlnaGJvdXJzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3VuaXEvdW5pcS5qcyIsIm5vZGVfbW9kdWxlcy92b24tbmV1bWFubi9pbmRleC5qcyIsIi4uLy4uLy4uLy4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2WUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Y0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJ2YXIgdXRpbHMgPSByZXF1aXJlKCcuL2xpYi91dGlscycpLFxuICAgIHBhcnNlciA9IHJlcXVpcmUoJ2NlbGx1bGFyLWF1dG9tYXRhLXJ1bGUtcGFyc2VyJyksXG4gICAgZ2VuZXJhdGVTaGFkZXJzMkQgPSByZXF1aXJlKCcuL2xpYi9jZWxsdWxhci1hdXRvbWF0YS1nbHNsLTJkJyksXG4gICAgZ2VuZXJhdGVTaGFkZXJzM0QgPSByZXF1aXJlKCcuL2xpYi9jZWxsdWxhci1hdXRvbWF0YS1nbHNsLTNkJyksXG4gICAgR3B1QmFja2VuZCA9IHJlcXVpcmUoJy4vbGliL2NlbGx1bGFyLWF1dG9tYXRhLWdwdS1iYWNrZW5kJyksXG4gICAgbW9vcmUgPSByZXF1aXJlKCdtb29yZScpLFxuICAgIHZvbk5ldW1hbm4gPSByZXF1aXJlKCd2b24tbmV1bWFubicpLFxuICAgIHVuY29udmVudGlvbmFsTmVpZ2hib3VycyA9IHJlcXVpcmUoJ3VuY29udmVudGlvbmFsLW5laWdoYm91cnMnKTtcblxudmFyIG5laWdoYm91cmhvb2RGdW5jdGlvbnMgPSB7XG4gICAgJ21vb3JlJzogbW9vcmUsXG4gICAgJ3Zvbi1uZXVtYW5uJzogdm9uTmV1bWFubixcbiAgICAnYXhpcyc6IHVuY29udmVudGlvbmFsTmVpZ2hib3Vycy5heGlzLFxuICAgICdjb3JuZXInOiB1bmNvbnZlbnRpb25hbE5laWdoYm91cnMuY29ybmVyLFxuICAgICdlZGdlJzogdW5jb252ZW50aW9uYWxOZWlnaGJvdXJzLmVkZ2UsXG4gICAgJ2ZhY2UnOiB1bmNvbnZlbnRpb25hbE5laWdoYm91cnMuZmFjZVxufTtcblxuLyoqXG4gKiBTb3J0IHRoZSBuZWlnaGJvdXJob29kIGZyb20gbGVmdCB0byByaWdodCwgdG9wIHRvIGJvdHRvbSwgLi4uXG4gKiBAcGFyYW0ge0FycmF5fSBhIEZpcnN0IG5laWdoYm91clxuICogQHBhcmFtIHtBcnJheX0gYiBTZWNvbmQgbmVpZ2hib3VyXG4gKiBAcmV0dXJucyB7bnVtYmVyfVxuICovXG52YXIgbmVpZ2hib3VyaG9vZFNvcnRlciA9IGZ1bmN0aW9uIG5laWdoYm91cmhvb2RTb3J0ZXIgKGEsIGIpIHtcbiAgICBhID0gYS5qb2luKCcsJyk7XG4gICAgYiA9IGIuam9pbignLCcpO1xuICAgIHJldHVybiBhID4gYiA/IDEgOiBhIDwgYiA/IC0xIDogMDtcbn07XG5cbnZhciBnZXROZWlnaGJvdXJob29kID0gZnVuY3Rpb24gZ2V0TmVpZ2hib3VyaG9vZChuZWlnaGJvdXJob29kVHlwZSwgbmVpZ2hib3VyaG9vZFJhbmdlLCBkaW1lbnNpb24pIHtcbiAgICBuZWlnaGJvdXJob29kVHlwZSA9ICEhbmVpZ2hib3VyaG9vZEZ1bmN0aW9uc1tuZWlnaGJvdXJob29kVHlwZV0gPyBuZWlnaGJvdXJob29kVHlwZSA6ICdtb29yZSc7XG4gICAgbmVpZ2hib3VyaG9vZFJhbmdlID0gbmVpZ2hib3VyaG9vZFJhbmdlIHx8IDE7XG4gICAgZGltZW5zaW9uID0gZGltZW5zaW9uIHx8IDI7XG5cbiAgICB2YXIgbmVpZ2hib3VyaG9vZCA9IG5laWdoYm91cmhvb2RGdW5jdGlvbnNbbmVpZ2hib3VyaG9vZFR5cGVdKG5laWdoYm91cmhvb2RSYW5nZSwgZGltZW5zaW9uKTtcbiAgICBuZWlnaGJvdXJob29kLnNvcnQobmVpZ2hib3VyaG9vZFNvcnRlcik7XG5cbiAgICByZXR1cm4gbmVpZ2hib3VyaG9vZDtcbn07XG5cbi8qKlxuICogQ2VsbHVsYXJBdXRvbWF0YUdwdSBjb25zdHJ1Y3RvclxuICogQHBhcmFtIHtpbnRbXX0gc2hhcGUgU2hhcGUgb2YgdGhlIGdyaWRcbiAqIEBwYXJhbSB7aW50fSBbZGVmYXVsdFZhbHVlPTBdIERlZmF1bHQgdmFsdWUgb2YgdGhlIGNlbGxzXG4gKiBAY29uc3RydWN0b3JcbiAqL1xudmFyIENlbGx1bGFyQXV0b21hdGFHcHUgPSBmdW5jdGlvbiBDZWxsdWxhckF1dG9tYXRhR3B1IChzaGFwZSwgZGVmYXVsdFZhbHVlKSB7XG4gICAgdGhpcy5zaGFwZSA9IHNoYXBlO1xuICAgIHRoaXMuZGltZW5zaW9uID0gc2hhcGUubGVuZ3RoO1xuXG4gICAgaWYgKHRoaXMuZGltZW5zaW9uICE9PSAyICYmIHRoaXMuZGltZW5zaW9uICE9PSAzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ2VsbHVsYXJBdXRvbWF0YUdwdSBkb2VzIG5vdCBzdXBwb3J0IGRpbWVuc2lvbnMgb3RoZXIgdGhhbiAyIGFuZCAzLicpO1xuICAgIH1cblxuICAgIGRlZmF1bHRWYWx1ZSA9IGRlZmF1bHRWYWx1ZSB8fCAwO1xuXG4gICAgdGhpcy5hcnJheSA9IHV0aWxzLmNyZWF0ZUFycmF5KHNoYXBlLCBkZWZhdWx0VmFsdWUpO1xuICAgIHRoaXMuYmFja2VuZCA9IG5ldyBHcHVCYWNrZW5kKHRoaXMuc2hhcGUpO1xuICAgIHRoaXMucnVsZXMgPSBbXTtcbn07XG5cbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLnNoYXBlID0gbnVsbDtcbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLmRpbWVuc2lvbiA9IG51bGw7XG5DZWxsdWxhckF1dG9tYXRhR3B1LnByb3RvdHlwZS5hcnJheSA9IG51bGw7XG5cbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLmN1cnJlbnRSdWxlID0gbnVsbDtcbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLnJ1bGVzID0gbnVsbDtcbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLmJhY2tlbmQgPSBudWxsO1xuXG5DZWxsdWxhckF1dG9tYXRhR3B1LnByb3RvdHlwZS5vdXRPZkJvdW5kVmFsdWUgPSAwO1xuQ2VsbHVsYXJBdXRvbWF0YUdwdS5wcm90b3R5cGUub3V0T2ZCb3VuZFdyYXBwaW5nID0gZmFsc2U7XG5DZWxsdWxhckF1dG9tYXRhR3B1LnByb3RvdHlwZS5vdXRPZkJvdW5kQ2xhbXBpbmcgPSBmYWxzZTtcblxuLyoqXG4gKiBGaWxsIHRoZSBncmlkIHdpdGggYSBnaXZlbiBkaXN0cmlidXRpb25cbiAqIEBwYXJhbSB7QXJyYXlbXX0gZGlzdHJpYnV0aW9uIFRoZSBkaXN0cmlidXRpb24gdG8gZmlsbCB0aGUgZ3JpZCB3aXRoIChpZTogW1swLDkwXSwgWzEsMTBdXSBmb3IgOTAlIG9mIDAgYW5kIDEwJSBvZiAxKS4gTnVsbCB2YWx1ZXMgYXJlIGlnbm9yZWQuXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBbcm5nPU1hdGgucmFuZG9tXSBBIHJhbmRvbSBudW1iZXIgZ2VuZXJhdGlvbiBmdW5jdGlvbiwgZGVmYXVsdCB0byBNYXRoLnJhbmRvbSgpXG4gKiBAcmV0dXJucyB7Q2VsbHVsYXJBdXRvbWF0YUdwdX0gQ2VsbHVsYXJBdXRvbWF0YUdwdSBpbnN0YW5jZSBmb3IgbWV0aG9kIGNoYWluaW5nLlxuICovXG5DZWxsdWxhckF1dG9tYXRhR3B1LnByb3RvdHlwZS5maWxsV2l0aERpc3RyaWJ1dGlvbiA9IGZ1bmN0aW9uIChkaXN0cmlidXRpb24sIHJuZykge1xuICAgIHZhciBzdW0gPSAwLFxuICAgICAgICBhcnJheSA9IHRoaXMuYXJyYXkuZGF0YSxcbiAgICAgICAgbnVtYmVyT2ZEaXN0cmlidXRpb25zID0gZGlzdHJpYnV0aW9uLmxlbmd0aCxcbiAgICAgICAgc2VsZWN0aW9uLFxuICAgICAgICBpLFxuICAgICAgICBrO1xuXG4gICAgcm5nID0gcm5nIHx8IE1hdGgucmFuZG9tO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IG51bWJlck9mRGlzdHJpYnV0aW9uczsgaSsrKSB7XG4gICAgICAgIHN1bSArPSBkaXN0cmlidXRpb25baV1bMV07XG4gICAgfVxuXG4gICAgZm9yIChrID0gMDsgayA8IGFycmF5Lmxlbmd0aDsgaysrKSB7XG4gICAgICAgIHNlbGVjdGlvbiA9IHJuZygpICogc3VtO1xuXG4gICAgICAgIGZvciAoaSA9IDA7IGkgPCBudW1iZXJPZkRpc3RyaWJ1dGlvbnM7IGkrKykge1xuICAgICAgICAgICAgc2VsZWN0aW9uIC09IGRpc3RyaWJ1dGlvbltpXVsxXTtcbiAgICAgICAgICAgIGlmIChzZWxlY3Rpb24gPD0gMCAmJiBkaXN0cmlidXRpb25baV1bMF0gIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBhcnJheVtrXSA9IGRpc3RyaWJ1dGlvbltpXVswXTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBEZWZpbmUgdGhlIHZhbHVlIHVzZWQgZm9yIHRoZSBjZWxscyBvdXQgb2YgdGhlIGFycmF5J3MgYm91bmRzXG4gKiBAcGFyYW0ge2ludHxzdHJpbmd9IFtvdXRPZkJvdW5kVmFsdWU9MF0gQW55IGludGVnZXIgdmFsdWUgb3IgdGhlIHN0cmluZyBcIndyYXBcIiB0byBlbmFibGUgb3V0IG9mIGJvdW5kIHdyYXBwaW5nLlxuICogQHB1YmxpY1xuICogQHJldHVybnMge0NlbGx1bGFyQXV0b21hdGFHcHV9IENlbGx1bGFyQXV0b21hdGFHcHUgaW5zdGFuY2UgZm9yIG1ldGhvZCBjaGFpbmluZy5cbiAqL1xuQ2VsbHVsYXJBdXRvbWF0YUdwdS5wcm90b3R5cGUuc2V0T3V0T2ZCb3VuZFZhbHVlID0gZnVuY3Rpb24gKG91dE9mQm91bmRWYWx1ZSkge1xuICAgIGlmIChvdXRPZkJvdW5kVmFsdWUgPT09ICdjbGFtcCcpIHtcbiAgICAgICAgdGhpcy5vdXRPZkJvdW5kQ2xhbXBpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLm91dE9mQm91bmRXcmFwcGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLm91dE9mQm91bmRWYWx1ZSA9IDA7XG4gICAgfSBlbHNlIGlmIChvdXRPZkJvdW5kVmFsdWUgPT09ICd3cmFwJykge1xuICAgICAgICB0aGlzLm91dE9mQm91bmRDbGFtcGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLm91dE9mQm91bmRXcmFwcGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMub3V0T2ZCb3VuZFZhbHVlID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLm91dE9mQm91bmRDbGFtcGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLm91dE9mQm91bmRXcmFwcGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLm91dE9mQm91bmRWYWx1ZSA9IG91dE9mQm91bmRWYWx1ZSB8IDA7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY3VycmVudFJ1bGUgIT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5jdXJyZW50UnVsZSA9IHtcbiAgICAgICAgICAgIHJ1bGU6IHRoaXMuY3VycmVudFJ1bGUucnVsZSxcbiAgICAgICAgICAgIHNoYWRlcnM6IG51bGwsXG4gICAgICAgICAgICBpdGVyYXRpb246IDBcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBEZWZpbmUgdGhlIHJ1bGUgb2YgdGhlIGNlbGx1bGFyIGF1dG9tYXRhIGFuZCB0aGUgbmVpZ2hib3VyaG9vZCB0byBiZSB1c2VkLlxuICogQHBhcmFtIHtzdHJpbmd9IHJ1bGUgQSBydWxlIHN0cmluZyBpbiBMaWZlLCBWb3RlIGZvciBsaWZlLCBMVUtZIG9yIEV4dGVuZGVkIGZvcm1hdC5cbiAqIEBwdWJsaWNcbiAqIEByZXR1cm5zIHtDZWxsdWxhckF1dG9tYXRhR3B1fSBDZWxsdWxhckF1dG9tYXRhR3B1IGluc3RhbmNlIGZvciBtZXRob2QgY2hhaW5pbmcuXG4gKi9cbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLnNldFJ1bGUgPSBmdW5jdGlvbiAocnVsZSkge1xuICAgIHZhciBwYXJzZWRSdWxlID0gcGFyc2VyKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGUgPT09ICdkZWJ1ZycpIHtcbiAgICAgICAgcGFyc2VkUnVsZSA9IHsgcnVsZUZvcm1hdDogJ2RlYnVnJyB9O1xuICAgIH1cblxuICAgIGlmIChwYXJzZWRSdWxlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlIHJ1bGVzdHJpbmcgY291bGQgbm90IGJlIHBhcnNlZC4nKTtcbiAgICB9XG5cbiAgICB0aGlzLmN1cnJlbnRSdWxlID0ge1xuICAgICAgICBydWxlOiBwYXJzZWRSdWxlLFxuICAgICAgICBzaGFkZXJzOiBudWxsLFxuICAgICAgICBpdGVyYXRpb246IDBcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEFwcGx5IHRoZSBwcmV2aW91c2x5IGRlZmluZWQgQ0EgcnVsZSBtdWx0aXBsZSB0aW1lcy5cbiAqIEBwYXJhbSB7aW50fSBbaXRlcmF0aW9uTnVtYmVyPTFdIE51bWJlciBvZiBpdGVyYXRpb25zXG4gKiBAcHVibGljXG4gKiBAcmV0dXJucyB7Q2VsbHVsYXJBdXRvbWF0YUdwdX0gQ2VsbHVsYXJBdXRvbWF0YUdwdSBpbnN0YW5jZSBmb3IgbWV0aG9kIGNoYWluaW5nLlxuICovXG5DZWxsdWxhckF1dG9tYXRhR3B1LnByb3RvdHlwZS5pdGVyYXRlID0gZnVuY3Rpb24gKGl0ZXJhdGlvbk51bWJlcikge1xuICAgIGl0ZXJhdGlvbk51bWJlciA9IGl0ZXJhdGlvbk51bWJlciB8fCAxO1xuXG4gICAgaWYgKHRoaXMuY3VycmVudFJ1bGUuaXRlcmF0aW9uID09PSAwKSB7XG4gICAgICAgIHZhciBuZWlnaGJvdXJob29kID0gZ2V0TmVpZ2hib3VyaG9vZCh0aGlzLmN1cnJlbnRSdWxlLnJ1bGUubmVpZ2hib3VyaG9vZFR5cGUsIHRoaXMuY3VycmVudFJ1bGUucnVsZS5uZWlnaGJvdXJob29kUmFuZ2UsIHRoaXMuZGltZW5zaW9uKSxcbiAgICAgICAgICAgIG91dE9mQm91bmRWYWx1ZSA9IHRoaXMub3V0T2ZCb3VuZENsYW1waW5nID8gJ2NsYW1wJyA6ICh0aGlzLm91dE9mQm91bmRXcmFwcGluZyA/ICd3cmFwJyA6IHRoaXMub3V0T2ZCb3VuZFZhbHVlKTtcblxuICAgICAgICBpZiAodGhpcy5kaW1lbnNpb24gPT09IDIpIHtcbiAgICAgICAgICAgIHRoaXMuY3VycmVudFJ1bGUuc2hhZGVycyA9IGdlbmVyYXRlU2hhZGVyczJEKHRoaXMuY3VycmVudFJ1bGUucnVsZSwgbmVpZ2hib3VyaG9vZCwgdGhpcy5zaGFwZSwgdGhpcy5iYWNrZW5kLnZpZXdwb3J0V2lkdGgsIHRoaXMuYmFja2VuZC52aWV3cG9ydEhlaWdodCwgb3V0T2ZCb3VuZFZhbHVlKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLmRpbWVuc2lvbiA9PT0gMykge1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50UnVsZS5zaGFkZXJzID0gZ2VuZXJhdGVTaGFkZXJzM0QodGhpcy5jdXJyZW50UnVsZS5ydWxlLCBuZWlnaGJvdXJob29kLCB0aGlzLnNoYXBlLCB0aGlzLmJhY2tlbmQudmlld3BvcnRXaWR0aCwgdGhpcy5iYWNrZW5kLnZpZXdwb3J0SGVpZ2h0LCBvdXRPZkJvdW5kVmFsdWUpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucnVsZXMucHVzaCh0aGlzLmN1cnJlbnRSdWxlKTtcbiAgICB9XG5cbiAgICB0aGlzLmN1cnJlbnRSdWxlLml0ZXJhdGlvbiArPSBpdGVyYXRpb25OdW1iZXI7XG5cbiAgICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQXBwbHkgYSBnaXZlbiBydWxlIGZvciBhIGdpdmVuIG51bWJlciBvZiBpdGVyYXRpb25zLCBzaG9ydGN1dCBtZXRob2QgZm9yIHNldFJ1bGUgYW5kIGl0ZXJhdGVcbiAqIEBwYXJhbSB7c3RyaW5nfSBydWxlIEEgcnVsZSBzdHJpbmcgaW4gTGlmZSwgVm90ZSBmb3IgbGlmZSwgTFVLWSBvciBFeHRlbmRlZCBmb3JtYXQuXG4gKiBAcGFyYW0ge2ludH0gW2l0ZXJhdGlvbj0xXSBOdW1iZXIgb2YgaXRlcmF0aW9uc1xuICogQHB1YmxpY1xuICogQHJldHVybnMge0NlbGx1bGFyQXV0b21hdGFHcHV9IENlbGx1bGFyQXV0b21hdGFHcHUgaW5zdGFuY2UgZm9yIG1ldGhvZCBjaGFpbmluZy5cbiAqL1xuQ2VsbHVsYXJBdXRvbWF0YUdwdS5wcm90b3R5cGUuYXBwbHkgPSBmdW5jdGlvbiAocnVsZSwgaXRlcmF0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMuc2V0UnVsZShydWxlKS5pdGVyYXRlKGl0ZXJhdGlvbik7XG59O1xuXG4vKipcbiAqIEV4ZWN1dGUgYWxsIHRoZSBzdG9yZWQgb3BlcmF0aW9uIG9uIHRoZSBHUFVcbiAqIEBwdWJsaWNcbiAqIEByZXR1cm5zIHtDZWxsdWxhckF1dG9tYXRhR3B1fSBDZWxsdWxhckF1dG9tYXRhR3B1IGluc3RhbmNlIGZvciBtZXRob2QgY2hhaW5pbmcuXG4gKi9cbkNlbGx1bGFyQXV0b21hdGFHcHUucHJvdG90eXBlLmZpbmFsaXplID0gZnVuY3Rpb24gKCkge1xuICAgIGlmICh0aGlzLnJ1bGVzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLmJhY2tlbmQud3JpdGUodGhpcy5hcnJheSk7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnJ1bGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB0aGlzLmJhY2tlbmQuZXhlY3V0ZSh0aGlzLnJ1bGVzW2ldKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuYmFja2VuZC5yZWFkKHRoaXMuYXJyYXkpO1xuXG4gICAgICAgIHRoaXMucnVsZXMgPSBbXTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQ2VsbHVsYXJBdXRvbWF0YUdwdTtcblxuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1bmlxID0gcmVxdWlyZSgndW5pcScpO1xuXG52YXIgcHJpbnRGbG9hdCA9IGZ1bmN0aW9uIHByaW50RmxvYXQgKHYpIHtcbiAgICByZXR1cm4gKHYgPT09IHZ8MCA/IHYudG9GaXhlZCgxKSA6IHYudG9TdHJpbmcoMTApKTtcbn07XG5cbnZhciBnZW5lcmF0ZUdldFBpeGVsR2xzbCA9IGZ1bmN0aW9uIGdlbmVyYXRlR2V0UGl4ZWxHbHNsIChvdXRPZkJvdW5kVmFsdWUpIHtcbiAgICBvdXRPZkJvdW5kVmFsdWUgPSBvdXRPZkJvdW5kVmFsdWUgfHwgMDtcblxuICAgIGlmIChvdXRPZkJvdW5kVmFsdWUgPT09ICdjbGFtcCcpIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdpbnQgZ2V0UGl4ZWwoY29uc3QgaW4gdmVjMiBjdXJyZW50UG9zLCBjb25zdCBpbiB2ZWMyIGFkZCkgeycsXG4gICAgICAgICAgICAnICB2ZWMyIHBpeGVsUG9zID0gY2xhbXAoY3VycmVudFBvcyArIGFkZCwgdmVjMigwLiksIGlSZXNvbHV0aW9uIC0gdmVjMigxLikpIC8gaVJlc29sdXRpb247JyxcbiAgICAgICAgICAgICcgIHJldHVybiB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIHBpeGVsUG9zKS54KTsnLFxuICAgICAgICAgICAgJ30nXG4gICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgfSBlbHNlIGlmIChvdXRPZkJvdW5kVmFsdWUgPT09ICd3cmFwJykge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2ludCBnZXRQaXhlbChjb25zdCBpbiB2ZWMyIGN1cnJlbnRQb3MsIGNvbnN0IGluIHZlYzIgYWRkKSB7JyxcbiAgICAgICAgICAgICcgIHZlYzIgcGl4ZWxQb3MgPSBmcmFjdCgoY3VycmVudFBvcyArIGFkZCkgLyBpUmVzb2x1dGlvbik7JyxcbiAgICAgICAgICAgICcgIHJldHVybiB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIHBpeGVsUG9zKS54KTsnLFxuICAgICAgICAgICAgJ30nXG4gICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdpbnQgZ2V0UGl4ZWwoY29uc3QgaW4gdmVjMiBjdXJyZW50UG9zLCBjb25zdCBpbiB2ZWMyIGFkZCkgeycsXG4gICAgICAgICAgICAnICB2ZWMyIHBpeGVsUG9zID0gKGN1cnJlbnRQb3MgKyBhZGQpIC8gaVJlc29sdXRpb247JyxcbiAgICAgICAgICAgICcgIGlmKHBpeGVsUG9zLnggPCAwLiB8fCBwaXhlbFBvcy55IDwgMC4gfHwgcGl4ZWxQb3MueCA+PSAxLiB8fCBwaXhlbFBvcy55ID49IDEuKSB7JyxcbiAgICAgICAgICAgICcgICAgcmV0dXJuICcgKyBvdXRPZkJvdW5kVmFsdWUgKyAnOycsXG4gICAgICAgICAgICAnICB9IGVsc2UgeycsXG4gICAgICAgICAgICAnICAgIHJldHVybiB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIHBpeGVsUG9zKS54KTsnLFxuICAgICAgICAgICAgJyAgfScsXG4gICAgICAgICAgICAnfSdcbiAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9XG59O1xuXG52YXIgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kID0gZnVuY3Rpb24gKG5laWdoYm91cmhvb2QpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgJ2ludCBnZXROZWlnaGJvdXJob29kIChjb25zdCBpbiB2ZWMyIGN1cnJlbnRQb3MpIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gMDsnLFxuICAgICAgICAnJ1xuICAgIF07XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5laWdoYm91cmhvb2QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5laWdoYm91ciA9IG5laWdoYm91cmhvb2RbaV07XG4gICAgICAgIGdsc2wucHVzaCgnICBzdW0gKz0gZ2V0UGl4ZWwoY3VycmVudFBvcywgdmVjMignICsgcHJpbnRGbG9hdChuZWlnaGJvdXJbMF0pICsgJywgJyArIHByaW50RmxvYXQobmVpZ2hib3VyWzFdKSArICcpKSA+IDAgPyAxIDogMDsnKTtcbiAgICB9XG5cbiAgICBnbHNsLnB1c2goJycsICcgIHJldHVybiBzdW07JywgJ30nKTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlR2V0TmVpZ2hib3VyaG9vZENvbmQgPSBmdW5jdGlvbiAobmVpZ2hib3VyaG9vZCkge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICAnaW50IGdldE5laWdoYm91cmhvb2RDb25kIChjb25zdCBpbiB2ZWMyIGN1cnJlbnRQb3MsIGNvbnN0IGluIGludCBkZXNpcmVkVmFsdWUpIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gMDsnLFxuICAgICAgICAnJ1xuICAgIF07XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5laWdoYm91cmhvb2QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5laWdoYm91ciA9IG5laWdoYm91cmhvb2RbaV07XG4gICAgICAgIGdsc2wucHVzaCgnICBzdW0gKz0gZ2V0UGl4ZWwoY3VycmVudFBvcywgdmVjMignICsgcHJpbnRGbG9hdChuZWlnaGJvdXJbMF0pICsgJywgJyArIHByaW50RmxvYXQobmVpZ2hib3VyWzFdKSArICcpKSA9PSBkZXNpcmVkVmFsdWUgPyAxIDogMDsnKTtcbiAgICB9XG5cbiAgICBnbHNsLnB1c2goJycsICcgIHJldHVybiBzdW07JywgJ30nKTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlUmFuZG9tRnVuY3Rpb24gPSBmdW5jdGlvbiBnZW5lcmF0ZVJhbmRvbUZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gW1xuICAgICAgICAnZmxvYXQgcmFuZCh2ZWMyIGNvLCBmbG9hdCBzZWVkKSB7JyxcbiAgICAgICAgJyAgY28gPSBjbyArIHZlYzIoZnJhY3Qoc2luKGRvdCh2ZWMyKGlGcmFtZSAqIDUuOTg5OCwgc2VlZCAqIDc4LjU0NTMpLCB2ZWMyKDEyLjk4OTgsNzguMjMzKSkpICogNDM3NTguNTQ1MykpOycsXG4gICAgICAgICcgIHJldHVybiBmcmFjdChzaW4oZG90KGNvLnh5LCB2ZWMyKDEyLjk4OTgsNzguMjMzKSkpICogNDM3NTguNTQ1Myk7JyxcbiAgICAgICAgJ30nXG4gICAgXS5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2sgPSBmdW5jdGlvbiBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2sgKHZhbHVlcywgdmFyaWFibGUpIHtcbiAgICB2YXIgY2hlY2tTdHJpbmcgPSBbXSxcbiAgICAgICAgZ3JvdXBlZFZhbHVlcyA9IFtdLFxuICAgICAgICBwcmV2aW91c1ZhbHVlID0gbnVsbCxcbiAgICAgICAgaTtcblxuICAgIHZhcmlhYmxlID0gdmFyaWFibGUgfHwgJ3N1bSc7XG5cbiAgICBpZiAodmFsdWVzICYmIHZhbHVlcy5sZW5ndGgpIHtcbiAgICAgICAgdmFsdWVzLnNvcnQoZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEgLSBiO1xuICAgICAgICB9KTtcblxuICAgICAgICB1bmlxKHZhbHVlcywgbnVsbCwgdHJ1ZSk7XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHZhbHVlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKHByZXZpb3VzVmFsdWUgPT09IHZhbHVlc1tpXSAtIDEpIHtcbiAgICAgICAgICAgICAgICBncm91cGVkVmFsdWVzW2dyb3VwZWRWYWx1ZXMubGVuZ3RoIC0gMV0ucHVzaCh2YWx1ZXNbaV0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBncm91cGVkVmFsdWVzLnB1c2goW3ZhbHVlc1tpXV0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcmV2aW91c1ZhbHVlID0gdmFsdWVzW2ldO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGdyb3VwZWRWYWx1ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChncm91cGVkVmFsdWVzW2ldLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICBjaGVja1N0cmluZy5wdXNoKCcoJyArIHZhcmlhYmxlICsgJyA+PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVswXSArICcgJiYgJyArIHZhcmlhYmxlICsgJyA8PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVtncm91cGVkVmFsdWVzW2ldLmxlbmd0aCAtIDFdICsgJyknKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY2hlY2tTdHJpbmcucHVzaCh2YXJpYWJsZSArICcgPT0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bMF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY2hlY2tTdHJpbmcucHVzaCgnZmFsc2UnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hlY2tTdHJpbmcubGVuZ3RoID4gMSA/ICcoJyArIGNoZWNrU3RyaW5nLmpvaW4oJyB8fCAnKSArICcpJyA6IGNoZWNrU3RyaW5nWzBdO1xufTtcblxudmFyIGdlbmVyYXRlUHJvYmFiaWxpdHlDaGVjayA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvYmFiaWxpdHlDaGVjayhwcm9iYWJpbGl0aWVzLCBzdW1WYXJpYWJsZSwgcG9zaXRpb25WYXJpYWJsZSkge1xuICAgIHZhciBjaGVja1N0cmluZyA9IFtdLFxuICAgICAgICBncm91cGVkVmFsdWVzID0gW10sXG4gICAgICAgIGdyb3VwUHJvYmFiaWxpdGllcyA9IFtdLFxuICAgICAgICB2YWx1ZSA9IG51bGwsXG4gICAgICAgIHByb2JhYmlsaXR5ID0gbnVsbCxcbiAgICAgICAgcHJldmlvdXNWYWx1ZSA9IG51bGwsXG4gICAgICAgIHByZXZpb3VzUHJvYmFiaWxpdHkgPSBudWxsLFxuICAgICAgICBpO1xuXG4gICAgc3VtVmFyaWFibGUgPSBzdW1WYXJpYWJsZSB8fCAnc3VtJztcbiAgICBwb3NpdGlvblZhcmlhYmxlID0gcG9zaXRpb25WYXJpYWJsZSB8fCAncG9zaXRpb24nO1xuXG4gICAgZm9yIChpIGluIHByb2JhYmlsaXRpZXMpIHtcbiAgICAgICAgdmFsdWUgPSBwYXJzZUludChpLCAxMCk7XG4gICAgICAgIHByb2JhYmlsaXR5ID0gcHJvYmFiaWxpdGllc1tpXTtcblxuICAgICAgICBpZiAocHJldmlvdXNWYWx1ZSA9PT0gdmFsdWUgLSAxICYmIHByZXZpb3VzUHJvYmFiaWxpdHkgPT09IHByb2JhYmlsaXR5KSB7XG4gICAgICAgICAgICBncm91cGVkVmFsdWVzW2dyb3VwZWRWYWx1ZXMubGVuZ3RoIC0gMV0ucHVzaCh2YWx1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBncm91cGVkVmFsdWVzLnB1c2goW3ZhbHVlXSk7XG4gICAgICAgICAgICBncm91cFByb2JhYmlsaXRpZXMucHVzaChwcm9iYWJpbGl0eSk7XG4gICAgICAgIH1cblxuICAgICAgICBwcmV2aW91c1ZhbHVlID0gdmFsdWU7XG4gICAgICAgIHByZXZpb3VzUHJvYmFiaWxpdHkgPSBwcm9iYWJpbGl0eTtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgZ3JvdXBQcm9iYWJpbGl0aWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHByb2JhYmlsaXR5ID0gZ3JvdXBQcm9iYWJpbGl0aWVzW2ldO1xuXG4gICAgICAgIGlmIChwcm9iYWJpbGl0eSA9PT0gMSkge1xuICAgICAgICAgICAgaWYgKGdyb3VwZWRWYWx1ZXNbaV0ubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGNoZWNrU3RyaW5nLnB1c2goJygnICsgc3VtVmFyaWFibGUgKyAnID49ICcgKyBncm91cGVkVmFsdWVzW2ldWzBdICsgJyAmJiAnICsgc3VtVmFyaWFibGUgKyAnIDw9ICcgKyBncm91cGVkVmFsdWVzW2ldW2dyb3VwZWRWYWx1ZXNbaV0ubGVuZ3RoIC0gMV0gKyAnKScpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjaGVja1N0cmluZy5wdXNoKHN1bVZhcmlhYmxlICsgJyA9PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVswXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAocHJvYmFiaWxpdHkgPiAwKSB7XG4gICAgICAgICAgICBpZiAoZ3JvdXBlZFZhbHVlc1tpXS5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICAgICAgY2hlY2tTdHJpbmcucHVzaCgnKCcgKyBzdW1WYXJpYWJsZSArICcgPj0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bMF0gKyAnICYmICcgKyBzdW1WYXJpYWJsZSArICcgPD0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bZ3JvdXBlZFZhbHVlc1tpXS5sZW5ndGggLSAxXSArICcgJiYgcmFuZCgnICsgcG9zaXRpb25WYXJpYWJsZSArICcsIDEuKSA8ICcgKyBwcm9iYWJpbGl0eSArICcpJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNoZWNrU3RyaW5nLnB1c2goJygnICsgc3VtVmFyaWFibGUgKyAnID09ICcgKyBncm91cGVkVmFsdWVzW2ldWzBdICsgJyAmJiByYW5kKCcgKyBwb3NpdGlvblZhcmlhYmxlICsgJywgMS4pIDwgJyArIHByb2JhYmlsaXR5ICsgJyknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGVja1N0cmluZy5sZW5ndGggPiAxID8gJygnICsgY2hlY2tTdHJpbmcuam9pbignIHx8ICcpICsgJyknIDogY2hlY2tTdHJpbmdbMF07XG59O1xuXG52YXIgZ2VuZXJhdGVQcm9jZXNzR2xzbEdlbmVyYXRpb25zID0gZnVuY3Rpb24gZ2VuZXJhdGVQcm9jZXNzR2xzbEdlbmVyYXRpb25zIChuZWlnaGJvdXJob29kLCBzdGF0ZUNvdW50LCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kQ29uZChuZWlnaGJvdXJob29kKSxcbiAgICAgICAgJycsXG4gICAgICAgICdpbnQgcHJvY2Vzcyhjb25zdCBpbiBpbnQgY3VycmVudFZhbHVlLCBjb25zdCBpbiB2ZWMyIHBvc2l0aW9uKSB7JyxcbiAgICAgICAgJyAgaW50IHN1bSA9IGdldE5laWdoYm91cmhvb2RDb25kKHBvc2l0aW9uLCAxKTsnLFxuICAgICAgICAnICBpZiAoY3VycmVudFZhbHVlID09IDAgJiYgJyArIGdlbmVyYXRlRXF1YWxpdHlDaGVjayhiaXJ0aCkgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PSAxICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gaW50KG1vZChmbG9hdChjdXJyZW50VmFsdWUgKyAxKSwgJyArIHByaW50RmxvYXQoc3RhdGVDb3VudCkgKyAnKSk7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsTGlmZSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xMaWZlIChuZWlnaGJvdXJob29kLCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzIgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZChwb3NpdGlvbik7JyxcbiAgICAgICAgJyAgaWYgKGN1cnJlbnRWYWx1ZSA9PSAwICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soYmlydGgpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsU3RvY2hhc3RpYyA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xTdG9jaGFzdGljIChuZWlnaGJvdXJob29kLCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVSYW5kb21GdW5jdGlvbigpLFxuICAgICAgICAnJyxcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzIgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZChwb3NpdGlvbik7JyxcbiAgICAgICAgJyAgaWYgKGN1cnJlbnRWYWx1ZSA9PSAwICYmICcgKyBnZW5lcmF0ZVByb2JhYmlsaXR5Q2hlY2soYmlydGgpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwICYmICcgKyBnZW5lcmF0ZVByb2JhYmlsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsVm90ZSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xWb3RlIChuZWlnaGJvdXJob29kLCB2b3Rlcykge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2QobmVpZ2hib3VyaG9vZCksXG4gICAgICAgICcnLFxuICAgICAgICAnaW50IHByb2Nlc3MoY29uc3QgaW4gaW50IGN1cnJlbnRWYWx1ZSwgY29uc3QgaW4gdmVjMiBwb3NpdGlvbikgeycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kKHBvc2l0aW9uKSArIChjdXJyZW50VmFsdWUgPiAwID8gMSA6IDApOycsXG4gICAgICAgICcgIGlmICgnICsgZ2VuZXJhdGVFcXVhbGl0eUNoZWNrKHZvdGVzKSArICcpIHsnLFxuICAgICAgICAnICAgIHJldHVybiAxOycsXG4gICAgICAgICcgIH0nLFxuICAgICAgICAnICByZXR1cm4gMDsnLFxuICAgICAgICAnfSdcbiAgICBdO1xuXG4gICAgcmV0dXJuIGdsc2wuam9pbignXFxuJyk7XG59O1xuXG52YXIgZ2VuZXJhdGVQcm9jZXNzR2xzbEx1a3kgPSBmdW5jdGlvbiBnZW5lcmF0ZVByb2Nlc3NHbHNsTHVreSAobmVpZ2hib3VyaG9vZCwgbG93U3Vydml2YWwsIGhpZ2hTdXJ2aXZhbCwgbG93QmlydGgsIGhpZ2hCaXJ0aCkge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2QobmVpZ2hib3VyaG9vZCksXG4gICAgICAgICcnLFxuICAgICAgICAnaW50IHByb2Nlc3MoY29uc3QgaW4gaW50IGN1cnJlbnRWYWx1ZSwgY29uc3QgaW4gdmVjMiBwb3NpdGlvbikgeycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kKHBvc2l0aW9uKTsnLFxuICAgICAgICAnICBpZiAoY3VycmVudFZhbHVlID09IDAgJiYgc3VtID49ICcgKyBsb3dCaXJ0aCArICcgJiYgc3VtIDw9ICcgKyBoaWdoQmlydGggKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+IDAgJiYgc3VtID49ICcgKyBsb3dTdXJ2aXZhbCArICcgJiYgc3VtIDw9ICcgKyBoaWdoU3Vydml2YWwgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9JyxcbiAgICAgICAgJyAgcmV0dXJuIDA7JyxcbiAgICAgICAgJ30nXG4gICAgXTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlUHJvY2Vzc0dsc2xObHVreSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xObHVreSAobmVpZ2hib3VyaG9vZCwgc3RhdGVDb3VudCwgbG93U3Vydml2YWwsIGhpZ2hTdXJ2aXZhbCwgbG93QmlydGgsIGhpZ2hCaXJ0aCkge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2RDb25kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzIgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZENvbmQocG9zaXRpb24sIDEpOycsXG4gICAgICAgICcgIGlmIChjdXJyZW50VmFsdWUgPT0gMCAmJiBzdW0gPj0gJyArIGxvd0JpcnRoICsgJyAmJiBzdW0gPD0gJyArIGhpZ2hCaXJ0aCArICcpIHsnLFxuICAgICAgICAnICAgIHJldHVybiAxOycsXG4gICAgICAgICcgIH0gZWxzZSBpZiAoY3VycmVudFZhbHVlID09IDEgJiYgc3VtID49ICcgKyBsb3dTdXJ2aXZhbCArICcgJiYgc3VtIDw9ICcgKyBoaWdoU3Vydml2YWwgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PSAxKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gJyArICgyICUgKDIgKyBzdGF0ZUNvdW50ICogMikpICsgJzsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+PSAyKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gaW50KG1vZChmbG9hdChjdXJyZW50VmFsdWUgKyAyKSwgJyArIHByaW50RmxvYXQoMiArIHN0YXRlQ291bnQgKiAyKSArICcpKTsnLFxuICAgICAgICAnICB9JyxcbiAgICAgICAgJyAgcmV0dXJuIDA7JyxcbiAgICAgICAgJ30nXG4gICAgXTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlUHJvY2Vzc0dsc2xDeWNsaWMgPSBmdW5jdGlvbiBnZW5lcmF0ZVByb2Nlc3NHbHNsQ3ljbGljIChuZWlnaGJvdXJob29kLCBzdGF0ZUNvdW50LCB0aHJlc2hvbGQsIGdyZWVuYmVyZ0hhc3RpbmdzTW9kZWwpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kQ29uZChuZWlnaGJvdXJob29kKSxcbiAgICAgICAgJycsXG4gICAgICAgICdpbnQgcHJvY2Vzcyhjb25zdCBpbiBpbnQgY3VycmVudFZhbHVlLCBjb25zdCBpbiB2ZWMyIHBvc2l0aW9uKSB7JyxcbiAgICAgICAgJyAgaW50IG5leHRWYWx1ZSA9IGludChtb2QoZmxvYXQoY3VycmVudFZhbHVlICsgMSksICcgKyBwcmludEZsb2F0KHN0YXRlQ291bnQpICsgJykpOycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kQ29uZChwb3NpdGlvbiwgbmV4dFZhbHVlKTsnLFxuICAgICAgICAnICBpZiAoc3VtID49ICcgKyB0aHJlc2hvbGQgKyAoZ3JlZW5iZXJnSGFzdGluZ3NNb2RlbCA/ICcgfHwgY3VycmVudFZhbHVlID4gMCcgOiAnJykgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gbmV4dFZhbHVlOycsXG4gICAgICAgICcgIH0nLFxuICAgICAgICAnICByZXR1cm4gY3VycmVudFZhbHVlOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsID0gZnVuY3Rpb24gZ2VuZXJhdGVQcm9jZXNzR2xzbCAobmVpZ2hib3VyaG9vZCwgcnVsZSkge1xuICAgIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICdsaWZlJyB8fCBydWxlLnJ1bGVGb3JtYXQgPT09ICdleHRlbmRlZC1saWZlJykge1xuICAgICAgICByZXR1cm4gZ2VuZXJhdGVQcm9jZXNzR2xzbExpZmUobmVpZ2hib3VyaG9vZCwgcnVsZS5zdXJ2aXZhbCwgcnVsZS5iaXJ0aCk7XG4gICAgfSBlbHNlIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICdleHRlbmRlZC1zdG9jaGFzdGljJykge1xuICAgICAgICByZXR1cm4gZ2VuZXJhdGVQcm9jZXNzR2xzbFN0b2NoYXN0aWMobmVpZ2hib3VyaG9vZCwgcnVsZS5zdXJ2aXZhbCwgcnVsZS5iaXJ0aCk7XG4gICAgfSBlbHNlIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICdnZW5lcmF0aW9ucycgfHwgcnVsZS5ydWxlRm9ybWF0ID09PSAnZXh0ZW5kZWQtZ2VuZXJhdGlvbnMnKSB7XG4gICAgICAgIHJldHVybiBnZW5lcmF0ZVByb2Nlc3NHbHNsR2VuZXJhdGlvbnMobmVpZ2hib3VyaG9vZCwgcnVsZS5zdGF0ZUNvdW50LCBydWxlLnN1cnZpdmFsLCBydWxlLmJpcnRoKTtcbiAgICB9IGVsc2UgaWYgKHJ1bGUucnVsZUZvcm1hdCA9PT0gJ3ZvdGUnKSB7XG4gICAgICAgIHJldHVybiBnZW5lcmF0ZVByb2Nlc3NHbHNsVm90ZShuZWlnaGJvdXJob29kLCBydWxlLnZvdGUpO1xuICAgIH0gZWxzZSBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnbHVreScpIHtcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlUHJvY2Vzc0dsc2xMdWt5KG5laWdoYm91cmhvb2QsIHJ1bGUubG93U3Vydml2YWwsIHJ1bGUuaGlnaFN1cnZpdmFsLCBydWxlLmxvd0JpcnRoLCBydWxlLmhpZ2hCaXJ0aCk7XG4gICAgfSBlbHNlIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICdubHVreScpIHtcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlUHJvY2Vzc0dsc2xObHVreShuZWlnaGJvdXJob29kLCBydWxlLnN0YXRlQ291bnQsIHJ1bGUubG93U3Vydml2YWwsIHJ1bGUuaGlnaFN1cnZpdmFsLCBydWxlLmxvd0JpcnRoLCBydWxlLmhpZ2hCaXJ0aCk7XG4gICAgfSBlbHNlIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICdjeWNsaWMnKSB7XG4gICAgICAgIHJldHVybiBnZW5lcmF0ZVByb2Nlc3NHbHNsQ3ljbGljKG5laWdoYm91cmhvb2QsIHJ1bGUuc3RhdGVDb3VudCwgcnVsZS50aHJlc2hvbGQsIHJ1bGUuZ3JlZW5iZXJnSGFzdGluZ3NNb2RlbCk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbnN1cHBvcnRlZCBydWxlRm9ybWF0IDogJyArIHJ1bGUucnVsZUZvcm1hdCk7XG59O1xuXG52YXIgZ2VuZXJhdGVDb21tZW50ID0gZnVuY3Rpb24gZ2VuZXJhdGVDb21tZW50ICh3aGF0LCBydWxlLCBkaW1lbnNpb25zLCBvdXRPZkJvdW5kVmFsdWUpIHtcbiAgICB2YXIgY29tbWVudHMgPSBbXG4gICAgICAgICcvKionLFxuICAgICAgICAnICogJyArIHdoYXQgKyAnIGdlbmVyYXRlZCBieSBjZWxsdWxhci1hdXRvbWF0YS1nbHNsIDAuMS4wJyxcbiAgICAgICAgJyAqJyxcbiAgICAgICAgJyAqIFJ1bGUgOiAnICsgcnVsZS5ydWxlU3RyaW5nLFxuICAgICAgICAnICogRGltZW5zaW9ucyA6ICcgKyBkaW1lbnNpb25zLmxlbmd0aCArICdEIFsnICsgZGltZW5zaW9ucy5qb2luKCcsICcpICsgJ10nLFxuICAgICAgICAnICogT3V0IG9mIGJvdW5kIHZhbHVlIDogJyArIG91dE9mQm91bmRWYWx1ZSxcbiAgICAgICAgJyAqLydcbiAgICBdO1xuXG4gICAgcmV0dXJuIGNvbW1lbnRzLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlVW5pZm9ybXNBbmRDb25zdGFudHMgPSBmdW5jdGlvbiBnZW5lcmF0ZVVuaWZvcm1zQW5kQ29uc3RhbnRzIChkaW1lbnNpb25zKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgICAgJ2NvbnN0IHZlYzIgaVJlc29sdXRpb24gPSB2ZWMyKCcgKyBkaW1lbnNpb25zWzBdICsgJywgJyArIGRpbWVuc2lvbnNbMV0gKyAnKTsnLFxuICAgICAgICAndW5pZm9ybSBzYW1wbGVyMkQgaUJhY2tidWZmZXI7JyxcbiAgICAgICAgJ3VuaWZvcm0gZmxvYXQgaUZyYW1lOydcbiAgICBdLmpvaW4oJ1xcbicpO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBnZW5lcmF0ZVNoYWRlcnMocnVsZSwgbmVpZ2hib3VyaG9vZCwgZGltZW5zaW9ucywgd2lkdGgsIGhlaWdodCwgb3V0T2ZCb3VuZFZhbHVlKSB7XG4gICAgaWYgKGRpbWVuc2lvbnMubGVuZ3RoICE9PSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRG9lcyBub3Qgc3VwcG9ydCBvdGhlciBkaW1lbnNpb24gdGhhbiAyRCcpO1xuICAgIH1cblxuICAgIHZhciBmcmFnbWVudEdsc2wgPSBbXG4gICAgICAgIGdlbmVyYXRlQ29tbWVudCgnRnJhZ21lbnQgc2hhZGVyJywgcnVsZSwgZGltZW5zaW9ucywgb3V0T2ZCb3VuZFZhbHVlKSxcbiAgICAgICAgJycsXG4gICAgICAgICcjaWZkZWYgR0xfRVMnLFxuICAgICAgICAncHJlY2lzaW9uIGhpZ2hwIGZsb2F0OycsXG4gICAgICAgICcjZW5kaWYnLFxuICAgICAgICAnJyxcbiAgICAgICAgZ2VuZXJhdGVVbmlmb3Jtc0FuZENvbnN0YW50cyhkaW1lbnNpb25zKSxcbiAgICAgICAgJycsXG4gICAgICAgICdpbnQgdW5wYWNrVmFsdWUoY29uc3QgaW4gZmxvYXQgcGFja2VkVmFsdWUpIHsnLFxuICAgICAgICAnIHJldHVybiBpbnQoKHBhY2tlZFZhbHVlICogMjU1LikgKyAwLjUpOycsXG4gICAgICAgICd9JyxcbiAgICAgICAgJycsXG4gICAgICAgICdmbG9hdCBwYWNrVmFsdWUoY29uc3QgaW4gaW50IHVucGFja2VkVmFsdWUpIHsnLFxuICAgICAgICAnIHJldHVybiBmbG9hdCh1bnBhY2tlZFZhbHVlKSAvIDI1NS47JyxcbiAgICAgICAgJ30nLFxuICAgICAgICAnJyxcbiAgICAgICAgZ2VuZXJhdGVHZXRQaXhlbEdsc2wob3V0T2ZCb3VuZFZhbHVlKSxcbiAgICAgICAgJycsXG4gICAgICAgIGdlbmVyYXRlUHJvY2Vzc0dsc2wobmVpZ2hib3VyaG9vZCwgcnVsZSksXG4gICAgICAgICcnLFxuICAgICAgICAndm9pZCBtYWluKCkgeycsXG4gICAgICAgICcgIGludCBjdXJyZW50VmFsdWUgPSB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIGdsX0ZyYWdDb29yZC54eSAvIGlSZXNvbHV0aW9uKS5yKTsnLFxuICAgICAgICAnICBnbF9GcmFnQ29sb3IgPSB2ZWM0KHBhY2tWYWx1ZShwcm9jZXNzKGN1cnJlbnRWYWx1ZSwgZ2xfRnJhZ0Nvb3JkLnh5KSkpOycsXG4gICAgICAgICd9JyxcbiAgICAgICAgJydcbiAgICBdO1xuXG4gICAgdmFyIHZlcnRleEdsc2wgPSBbXG4gICAgICAgIGdlbmVyYXRlQ29tbWVudCgnVmVydGV4IHNoYWRlcicsIHJ1bGUsIGRpbWVuc2lvbnMsIG91dE9mQm91bmRWYWx1ZSksXG4gICAgICAgICcnLFxuICAgICAgICAnYXR0cmlidXRlIHZlYzMgYVZlcnRleFBvc2l0aW9uOycsXG4gICAgICAgICd2b2lkIG1haW4oKSB7JyxcbiAgICAgICAgJyAgZ2xfUG9zaXRpb24gPSB2ZWM0KGFWZXJ0ZXhQb3NpdGlvbiwgMS4wKTsnLFxuICAgICAgICAnfScsXG4gICAgICAgICcnXG4gICAgXTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIHZlcnRleFNoYWRlcjogdmVydGV4R2xzbC5qb2luKCdcXG4nKSxcbiAgICAgICAgZnJhZ21lbnRTaGFkZXI6IGZyYWdtZW50R2xzbC5qb2luKCdcXG4nKVxuICAgIH07XG59O1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1bmlxID0gcmVxdWlyZSgndW5pcScpO1xuXG52YXIgcHJpbnRGbG9hdCA9IGZ1bmN0aW9uIHByaW50RmxvYXQgKHYpIHtcbiAgICByZXR1cm4gKHYgPT09IHZ8MCA/IHYudG9GaXhlZCgxKSA6IHYudG9TdHJpbmcoMTApKTtcbn07XG5cbnZhciBnZW5lcmF0ZUdldFBvc1RleHQgPSBmdW5jdGlvbiBnZW5lcmF0ZUdldFBvc1RleHQgKCkge1xuICAgIHJldHVybiBbXG4gICAgICAgICd2ZWMyIGdldFBvc1RleHQoY29uc3QgaW4gaXZlYzMgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBmbG9hdCBzcG9zaXRpb24gPSBmbG9hdChwb3NpdGlvbi54ICsgcG9zaXRpb24ueSAqIGludChpU3RyaWRlWSkgKyBwb3NpdGlvbi56ICogaW50KGlTdHJpZGVaKSk7JyxcbiAgICAgICAgJyAgcmV0dXJuIHZlYzIoJyxcbiAgICAgICAgJyAgICBtb2Qoc3Bvc2l0aW9uLCBpVGV4dHVyZVNpemUueCkgLyBpVGV4dHVyZVNpemUueCwnLFxuICAgICAgICAnICAgIGZsb29yKChzcG9zaXRpb24gLyBpVGV4dHVyZVNpemUueCkpIC8gaVRleHR1cmVTaXplLngnLFxuICAgICAgICAnICApOycsXG4gICAgICAgICd9J1xuICAgIF0uam9pbignXFxuJyk7XG59O1xuXG52YXIgZ2VuZXJhdGVHZXRQaXhlbEdsc2wgPSBmdW5jdGlvbiBnZW5lcmF0ZUdldFBpeGVsR2xzbCAob3V0T2ZCb3VuZFZhbHVlKSB7XG4gICAgb3V0T2ZCb3VuZFZhbHVlID0gb3V0T2ZCb3VuZFZhbHVlIHx8IDA7XG5cbiAgICBpZiAob3V0T2ZCb3VuZFZhbHVlID09PSAnY2xhbXAnKSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnaW50IGdldFBpeGVsKGNvbnN0IGluIHZlYzMgY3VycmVudFBvcywgY29uc3QgaW4gdmVjMyBhZGQpIHsnLFxuICAgICAgICAgICAgJyAgaXZlYzMgcG9zaXRpb24gPSBpdmVjMyhjbGFtcChjdXJyZW50UG9zICsgYWRkLCB2ZWMzKDAuKSwgaVJlYWxTaXplIC0gdmVjMygxLikpKTsnLFxuICAgICAgICAgICAgJyAgcmV0dXJuIHVucGFja1ZhbHVlKHRleHR1cmUyRChpQmFja2J1ZmZlciwgZ2V0UG9zVGV4dChwb3NpdGlvbikpLngpOycsXG4gICAgICAgICAgICAnfSdcbiAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9IGVsc2UgaWYgKG91dE9mQm91bmRWYWx1ZSA9PT0gJ3dyYXAnKSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnaW50IGdldFBpeGVsKGNvbnN0IGluIHZlYzMgY3VycmVudFBvcywgY29uc3QgaW4gdmVjMyBhZGQpIHsnLFxuICAgICAgICAgICAgJyAgaXZlYzMgcG9zaXRpb24gPSBpdmVjMyhtb2QoY3VycmVudFBvcyArIGFkZCwgaVJlYWxTaXplKSk7JyxcbiAgICAgICAgICAgICcgIHJldHVybiB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIGdldFBvc1RleHQocG9zaXRpb24pKS54KTsnLFxuICAgICAgICAgICAgJ30nXG4gICAgICAgIF0uam9pbignXFxuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdpbnQgZ2V0UGl4ZWwoY29uc3QgaW4gdmVjMyBjdXJyZW50UG9zLCBjb25zdCBpbiB2ZWMzIGFkZCkgeycsXG4gICAgICAgICAgICAnICBpdmVjMyBwb3NpdGlvbiA9IGl2ZWMzKGN1cnJlbnRQb3MgKyBhZGQpOycsXG4gICAgICAgICAgICAnICBpZignLFxuICAgICAgICAgICAgJyAgICBwb3NpdGlvbi54IDwgMCB8fCBwb3NpdGlvbi54ID49IGludChpUmVhbFNpemUueCkgfHwnLFxuICAgICAgICAgICAgJyAgICBwb3NpdGlvbi55IDwgMCB8fCBwb3NpdGlvbi55ID49IGludChpUmVhbFNpemUueSkgfHwnLFxuICAgICAgICAgICAgJyAgICBwb3NpdGlvbi56IDwgMCB8fCBwb3NpdGlvbi56ID49IGludChpUmVhbFNpemUueiknLFxuICAgICAgICAgICAgJyAgKSB7JyxcbiAgICAgICAgICAgICcgICAgcmV0dXJuICcgKyBvdXRPZkJvdW5kVmFsdWUgKyAnOycsXG4gICAgICAgICAgICAnICB9IGVsc2UgeycsXG4gICAgICAgICAgICAnICAgIHJldHVybiB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIGdldFBvc1RleHQocG9zaXRpb24pKS54KTsnLFxuICAgICAgICAgICAgJyAgfScsXG4gICAgICAgICAgICAnfSdcbiAgICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9XG59O1xuXG52YXIgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kID0gZnVuY3Rpb24gKG5laWdoYm91cmhvb2QpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgJ2ludCBnZXROZWlnaGJvdXJob29kIChjb25zdCBpbiB2ZWMyIGN1cnJlbnRQb3MpIHsnLFxuICAgICAgICAnICBmbG9hdCBzcG9zaXRpb24gPSBmbG9hdChpbnQoY3VycmVudFBvcy54KSArIGludChjdXJyZW50UG9zLnkpICogaW50KGlUZXh0dXJlU2l6ZS54KSk7JyxcbiAgICAgICAgJyAgdmVjMyBwaXhlbFBvcyA9IHZlYzMoJyxcbiAgICAgICAgJyAgICBtb2Qoc3Bvc2l0aW9uLCBpUmVhbFNpemUueCksJyxcbiAgICAgICAgJyAgICBtb2QoZmxvb3Ioc3Bvc2l0aW9uIC8gaVN0cmlkZVkpLCBpUmVhbFNpemUueSksJyxcbiAgICAgICAgJyAgICBmbG9vcihzcG9zaXRpb24gLyBpU3RyaWRlWiknLFxuICAgICAgICAnICApOycsXG4gICAgICAgICcgIGludCBzdW0gPSAwOycsXG4gICAgICAgICcnXG4gICAgXTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbmVpZ2hib3VyaG9vZC5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgbmVpZ2hib3VyID0gbmVpZ2hib3VyaG9vZFtpXTtcbiAgICAgICAgZ2xzbC5wdXNoKCcgIHN1bSArPSBnZXRQaXhlbChwaXhlbFBvcywgdmVjMygnICsgcHJpbnRGbG9hdChuZWlnaGJvdXJbMF0pICsgJywgJyArIHByaW50RmxvYXQobmVpZ2hib3VyWzFdKSArICcsICcgKyBwcmludEZsb2F0KG5laWdoYm91clsyXSkgKyAnKSkgPiAwID8gMSA6IDA7Jyk7XG4gICAgfVxuXG4gICAgZ2xzbC5wdXNoKCcnLCAnICByZXR1cm4gc3VtOycsICd9Jyk7XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2RDb25kID0gZnVuY3Rpb24gKG5laWdoYm91cmhvb2QpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgJ2ludCBnZXROZWlnaGJvdXJob29kQ29uZCAoY29uc3QgaW4gdmVjMiBjdXJyZW50UG9zLCBjb25zdCBpbiBpbnQgZGVzaXJlZFZhbHVlKSB7JyxcbiAgICAgICAgJyAgZmxvYXQgc3Bvc2l0aW9uID0gZmxvYXQoaW50KGN1cnJlbnRQb3MueCkgKyBpbnQoY3VycmVudFBvcy55KSAqIGludChpVGV4dHVyZVNpemUueCkpOycsXG4gICAgICAgICcgIHZlYzMgcGl4ZWxQb3MgPSB2ZWMzKCcsXG4gICAgICAgICcgICAgbW9kKHNwb3NpdGlvbiwgaVJlYWxTaXplLngpLCcsXG4gICAgICAgICcgICAgbW9kKGZsb29yKHNwb3NpdGlvbiAvIGlTdHJpZGVZKSwgaVJlYWxTaXplLnkpLCcsXG4gICAgICAgICcgICAgZmxvb3Ioc3Bvc2l0aW9uIC8gaVN0cmlkZVopJyxcbiAgICAgICAgJyAgKTsnLFxuICAgICAgICAnICBpbnQgc3VtID0gMDsnLFxuICAgICAgICAnJ1xuICAgIF07XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG5laWdoYm91cmhvb2QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5laWdoYm91ciA9IG5laWdoYm91cmhvb2RbaV07XG4gICAgICAgIGdsc2wucHVzaCgnICBzdW0gKz0gZ2V0UGl4ZWwocGl4ZWxQb3MsIHZlYzMoJyArIHByaW50RmxvYXQobmVpZ2hib3VyWzBdKSArICcsICcgKyBwcmludEZsb2F0KG5laWdoYm91clsxXSkgKyAnLCAnICsgcHJpbnRGbG9hdChuZWlnaGJvdXJbMl0pICsgJykpID09IGRlc2lyZWRWYWx1ZSA/IDEgOiAwOycpO1xuICAgIH1cblxuICAgIGdsc2wucHVzaCgnJywgJyAgcmV0dXJuIHN1bTsnLCAnfScpO1xuXG4gICAgcmV0dXJuIGdsc2wuam9pbignXFxuJyk7XG59O1xuXG52YXIgZ2VuZXJhdGVSYW5kb21GdW5jdGlvbiA9IGZ1bmN0aW9uIGdlbmVyYXRlUmFuZG9tRnVuY3Rpb24gKCkge1xuICAgIHJldHVybiBbXG4gICAgICAgICdmbG9hdCByYW5kKHZlYzMgY28sIGZsb2F0IHNlZWQpIHsnLFxuICAgICAgICAnICBjbyA9IGNvICsgdmVjMyhmcmFjdChzaW4oZG90KHZlYzIoaUZyYW1lICogNS45ODk4LCBzZWVkICogNzguNTQ1MyksIHZlYzIoMTIuOTg5OCw3OC4yMzMpKSkgKiA0Mzc1OC41NDUzKSk7JyxcbiAgICAgICAgJyAgcmV0dXJuIGZyYWN0KHNpbihkb3QoY28ueHkgKyB2ZWMyKGxlbmd0aChjby55eikgKiAyNC4wMzE2KSwgdmVjMigxMi45ODk4LDc4LjIzMykpICsgZG90KGNvLnl6ICsgdmVjMihsZW5ndGgoY28uengpICogMjQuMDMxNiksIHZlYzIoMTIuOTg5OCw3OC4yMzMpKSArIGRvdChjby56eCArIHZlYzIobGVuZ3RoKGNvLnh5KSAqIDI0LjAzMTYpLCB2ZWMyKDEyLjk4OTgsNzguMjMzKSkpICogNDM3NTguNTQ1Myk7JyxcbiAgICAgICAgJ30nXG4gICAgXS5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2sgPSBmdW5jdGlvbiBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2sgKHZhbHVlcywgdmFyaWFibGUpIHtcbiAgICB2YXIgY2hlY2tTdHJpbmcgPSBbXSxcbiAgICAgICAgZ3JvdXBlZFZhbHVlcyA9IFtdLFxuICAgICAgICBwcmV2aW91c1ZhbHVlID0gbnVsbCxcbiAgICAgICAgaTtcblxuICAgIHZhcmlhYmxlID0gdmFyaWFibGUgfHwgJ3N1bSc7XG5cbiAgICBpZiAodmFsdWVzICYmIHZhbHVlcy5sZW5ndGgpIHtcbiAgICAgICAgdmFsdWVzLnNvcnQoZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIGEgLSBiO1xuICAgICAgICB9KTtcblxuICAgICAgICB1bmlxKHZhbHVlcywgbnVsbCwgdHJ1ZSk7XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHZhbHVlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKHByZXZpb3VzVmFsdWUgPT09IHZhbHVlc1tpXSAtIDEpIHtcbiAgICAgICAgICAgICAgICBncm91cGVkVmFsdWVzW2dyb3VwZWRWYWx1ZXMubGVuZ3RoIC0gMV0ucHVzaCh2YWx1ZXNbaV0pO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBncm91cGVkVmFsdWVzLnB1c2goW3ZhbHVlc1tpXV0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBwcmV2aW91c1ZhbHVlID0gdmFsdWVzW2ldO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChpID0gMDsgaSA8IGdyb3VwZWRWYWx1ZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChncm91cGVkVmFsdWVzW2ldLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICBjaGVja1N0cmluZy5wdXNoKCcoJyArIHZhcmlhYmxlICsgJyA+PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVswXSArICcgJiYgJyArIHZhcmlhYmxlICsgJyA8PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVtncm91cGVkVmFsdWVzW2ldLmxlbmd0aCAtIDFdICsgJyknKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY2hlY2tTdHJpbmcucHVzaCh2YXJpYWJsZSArICcgPT0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bMF0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgICAgY2hlY2tTdHJpbmcucHVzaCgnZmFsc2UnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hlY2tTdHJpbmcubGVuZ3RoID4gMSA/ICcoJyArIGNoZWNrU3RyaW5nLmpvaW4oJyB8fCAnKSArICcpJyA6IGNoZWNrU3RyaW5nWzBdO1xufTtcblxudmFyIGdlbmVyYXRlUHJvYmFiaWxpdHlDaGVjayA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvYmFiaWxpdHlDaGVjayhwcm9iYWJpbGl0aWVzLCBzdW1WYXJpYWJsZSwgcG9zaXRpb25WYXJpYWJsZSkge1xuICAgIHZhciBjaGVja1N0cmluZyA9IFtdLFxuICAgICAgICBncm91cGVkVmFsdWVzID0gW10sXG4gICAgICAgIGdyb3VwUHJvYmFiaWxpdGllcyA9IFtdLFxuICAgICAgICB2YWx1ZSA9IG51bGwsXG4gICAgICAgIHByb2JhYmlsaXR5ID0gbnVsbCxcbiAgICAgICAgcHJldmlvdXNWYWx1ZSA9IG51bGwsXG4gICAgICAgIHByZXZpb3VzUHJvYmFiaWxpdHkgPSBudWxsLFxuICAgICAgICBpO1xuXG4gICAgc3VtVmFyaWFibGUgPSBzdW1WYXJpYWJsZSB8fCAnc3VtJztcbiAgICBwb3NpdGlvblZhcmlhYmxlID0gcG9zaXRpb25WYXJpYWJsZSB8fCAncG9zaXRpb24nO1xuXG4gICAgZm9yIChpIGluIHByb2JhYmlsaXRpZXMpIHtcbiAgICAgICAgdmFsdWUgPSBwYXJzZUludChpLCAxMCk7XG4gICAgICAgIHByb2JhYmlsaXR5ID0gcHJvYmFiaWxpdGllc1tpXTtcblxuICAgICAgICBpZiAocHJldmlvdXNWYWx1ZSA9PT0gdmFsdWUgLSAxICYmIHByZXZpb3VzUHJvYmFiaWxpdHkgPT09IHByb2JhYmlsaXR5KSB7XG4gICAgICAgICAgICBncm91cGVkVmFsdWVzW2dyb3VwZWRWYWx1ZXMubGVuZ3RoIC0gMV0ucHVzaCh2YWx1ZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBncm91cGVkVmFsdWVzLnB1c2goW3ZhbHVlXSk7XG4gICAgICAgICAgICBncm91cFByb2JhYmlsaXRpZXMucHVzaChwcm9iYWJpbGl0eSk7XG4gICAgICAgIH1cblxuICAgICAgICBwcmV2aW91c1ZhbHVlID0gdmFsdWU7XG4gICAgICAgIHByZXZpb3VzUHJvYmFiaWxpdHkgPSBwcm9iYWJpbGl0eTtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgZ3JvdXBQcm9iYWJpbGl0aWVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHByb2JhYmlsaXR5ID0gZ3JvdXBQcm9iYWJpbGl0aWVzW2ldO1xuXG4gICAgICAgIGlmIChwcm9iYWJpbGl0eSA9PT0gMSkge1xuICAgICAgICAgICAgaWYgKGdyb3VwZWRWYWx1ZXNbaV0ubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgIGNoZWNrU3RyaW5nLnB1c2goJygnICsgc3VtVmFyaWFibGUgKyAnID49ICcgKyBncm91cGVkVmFsdWVzW2ldWzBdICsgJyAmJiAnICsgc3VtVmFyaWFibGUgKyAnIDw9ICcgKyBncm91cGVkVmFsdWVzW2ldW2dyb3VwZWRWYWx1ZXNbaV0ubGVuZ3RoIC0gMV0gKyAnKScpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjaGVja1N0cmluZy5wdXNoKHN1bVZhcmlhYmxlICsgJyA9PSAnICsgZ3JvdXBlZFZhbHVlc1tpXVswXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAocHJvYmFiaWxpdHkgPiAwKSB7XG4gICAgICAgICAgICBpZiAoZ3JvdXBlZFZhbHVlc1tpXS5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICAgICAgY2hlY2tTdHJpbmcucHVzaCgnKCcgKyBzdW1WYXJpYWJsZSArICcgPj0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bMF0gKyAnICYmICcgKyBzdW1WYXJpYWJsZSArICcgPD0gJyArIGdyb3VwZWRWYWx1ZXNbaV1bZ3JvdXBlZFZhbHVlc1tpXS5sZW5ndGggLSAxXSArICcgJiYgcmFuZCgnICsgcG9zaXRpb25WYXJpYWJsZSArICcsIDEuKSA8ICcgKyBwcm9iYWJpbGl0eSArICcpJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNoZWNrU3RyaW5nLnB1c2goJygnICsgc3VtVmFyaWFibGUgKyAnID09ICcgKyBncm91cGVkVmFsdWVzW2ldWzBdICsgJyAmJiByYW5kKCcgKyBwb3NpdGlvblZhcmlhYmxlICsgJywgMS4pIDwgJyArIHByb2JhYmlsaXR5ICsgJyknKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjaGVja1N0cmluZy5sZW5ndGggPiAxID8gJygnICsgY2hlY2tTdHJpbmcuam9pbignIHx8ICcpICsgJyknIDogY2hlY2tTdHJpbmdbMF07XG59O1xuXG52YXIgZ2VuZXJhdGVQcm9jZXNzR2xzbEdlbmVyYXRpb25zID0gZnVuY3Rpb24gZ2VuZXJhdGVQcm9jZXNzR2xzbEdlbmVyYXRpb25zIChuZWlnaGJvdXJob29kLCBzdGF0ZUNvdW50LCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kQ29uZChuZWlnaGJvdXJob29kKSxcbiAgICAgICAgJycsXG4gICAgICAgICdpbnQgcHJvY2Vzcyhjb25zdCBpbiBpbnQgY3VycmVudFZhbHVlLCBjb25zdCBpbiB2ZWMyIHBvc2l0aW9uKSB7JyxcbiAgICAgICAgJyAgaW50IHN1bSA9IGdldE5laWdoYm91cmhvb2RDb25kKHBvc2l0aW9uLCAxKTsnLFxuICAgICAgICAnICBpZiAoY3VycmVudFZhbHVlID09IDAgJiYgJyArIGdlbmVyYXRlRXF1YWxpdHlDaGVjayhiaXJ0aCkgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PSAxICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gaW50KG1vZChmbG9hdChjdXJyZW50VmFsdWUgKyAxKSwgJyArIHByaW50RmxvYXQoc3RhdGVDb3VudCkgKyAnKSk7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsTGlmZSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xMaWZlIChuZWlnaGJvdXJob29kLCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzIgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZChwb3NpdGlvbik7JyxcbiAgICAgICAgJyAgaWYgKGN1cnJlbnRWYWx1ZSA9PSAwICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soYmlydGgpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwICYmICcgKyBnZW5lcmF0ZUVxdWFsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsU3RvY2hhc3RpYyA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xTdG9jaGFzdGljIChuZWlnaGJvdXJob29kLCBzdXJ2aXZhbCwgYmlydGgpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVSYW5kb21GdW5jdGlvbigpLFxuICAgICAgICAnJyxcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzMgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZChwb3NpdGlvbik7JyxcbiAgICAgICAgJyAgaWYgKGN1cnJlbnRWYWx1ZSA9PSAwICYmICcgKyBnZW5lcmF0ZVByb2JhYmlsaXR5Q2hlY2soYmlydGgpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPiAwICYmICcgKyBnZW5lcmF0ZVByb2JhYmlsaXR5Q2hlY2soc3Vydml2YWwpICsgJykgeycsXG4gICAgICAgICcgICAgcmV0dXJuIDE7JyxcbiAgICAgICAgJyAgfScsXG4gICAgICAgICcgIHJldHVybiAwOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsVm90ZSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xWb3RlIChuZWlnaGJvdXJob29kLCB2b3Rlcykge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2QobmVpZ2hib3VyaG9vZCksXG4gICAgICAgICcnLFxuICAgICAgICAnaW50IHByb2Nlc3MoY29uc3QgaW4gaW50IGN1cnJlbnRWYWx1ZSwgY29uc3QgaW4gdmVjMiBwb3NpdGlvbikgeycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kKHBvc2l0aW9uKSArIChjdXJyZW50VmFsdWUgPiAwID8gMSA6IDApOycsXG4gICAgICAgICcgIGlmICgnICsgZ2VuZXJhdGVFcXVhbGl0eUNoZWNrKHZvdGVzKSArICcpIHsnLFxuICAgICAgICAnICAgIHJldHVybiAxOycsXG4gICAgICAgICcgIH0nLFxuICAgICAgICAnICByZXR1cm4gMDsnLFxuICAgICAgICAnfSdcbiAgICBdO1xuXG4gICAgcmV0dXJuIGdsc2wuam9pbignXFxuJyk7XG59O1xuXG52YXIgZ2VuZXJhdGVQcm9jZXNzR2xzbEx1a3kgPSBmdW5jdGlvbiBnZW5lcmF0ZVByb2Nlc3NHbHNsTHVreSAobmVpZ2hib3VyaG9vZCwgbG93U3Vydml2YWwsIGhpZ2hTdXJ2aXZhbCwgbG93QmlydGgsIGhpZ2hCaXJ0aCkge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2QobmVpZ2hib3VyaG9vZCksXG4gICAgICAgICcnLFxuICAgICAgICAnaW50IHByb2Nlc3MoY29uc3QgaW4gaW50IGN1cnJlbnRWYWx1ZSwgY29uc3QgaW4gdmVjMiBwb3NpdGlvbikgeycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kKHBvc2l0aW9uKTsnLFxuICAgICAgICAnICBpZiAoY3VycmVudFZhbHVlID09IDAgJiYgc3VtID49ICcgKyBsb3dCaXJ0aCArICcgJiYgc3VtIDw9ICcgKyBoaWdoQmlydGggKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+IDAgJiYgc3VtID49ICcgKyBsb3dTdXJ2aXZhbCArICcgJiYgc3VtIDw9ICcgKyBoaWdoU3Vydml2YWwgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9JyxcbiAgICAgICAgJyAgcmV0dXJuIDA7JyxcbiAgICAgICAgJ30nXG4gICAgXTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlUHJvY2Vzc0dsc2xObHVreSA9IGZ1bmN0aW9uIGdlbmVyYXRlUHJvY2Vzc0dsc2xObHVreSAobmVpZ2hib3VyaG9vZCwgc3RhdGVDb3VudCwgbG93U3Vydml2YWwsIGhpZ2hTdXJ2aXZhbCwgbG93QmlydGgsIGhpZ2hCaXJ0aCkge1xuICAgIHZhciBnbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUdldE5laWdoYm91cmhvb2RDb25kKG5laWdoYm91cmhvb2QpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2ludCBwcm9jZXNzKGNvbnN0IGluIGludCBjdXJyZW50VmFsdWUsIGNvbnN0IGluIHZlYzIgcG9zaXRpb24pIHsnLFxuICAgICAgICAnICBpbnQgc3VtID0gZ2V0TmVpZ2hib3VyaG9vZENvbmQocG9zaXRpb24sIDEpOycsXG4gICAgICAgICcgIGlmIChjdXJyZW50VmFsdWUgPT0gMCAmJiBzdW0gPj0gJyArIGxvd0JpcnRoICsgJyAmJiBzdW0gPD0gJyArIGhpZ2hCaXJ0aCArICcpIHsnLFxuICAgICAgICAnICAgIHJldHVybiAxOycsXG4gICAgICAgICcgIH0gZWxzZSBpZiAoY3VycmVudFZhbHVlID09IDEgJiYgc3VtID49ICcgKyBsb3dTdXJ2aXZhbCArICcgJiYgc3VtIDw9ICcgKyBoaWdoU3Vydml2YWwgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gMTsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PSAxKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gJyArICgyICUgKDIgKyBzdGF0ZUNvdW50ICogMikpICsgJzsnLFxuICAgICAgICAnICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+PSAyKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gaW50KG1vZChmbG9hdChjdXJyZW50VmFsdWUgKyAyKSwgJyArIHByaW50RmxvYXQoMiArIHN0YXRlQ291bnQgKiAyKSArICcpKTsnLFxuICAgICAgICAnICB9JyxcbiAgICAgICAgJyAgcmV0dXJuIDA7JyxcbiAgICAgICAgJ30nXG4gICAgXTtcblxuICAgIHJldHVybiBnbHNsLmpvaW4oJ1xcbicpO1xufTtcblxudmFyIGdlbmVyYXRlUHJvY2Vzc0dsc2xDeWNsaWMgPSBmdW5jdGlvbiBnZW5lcmF0ZVByb2Nlc3NHbHNsQ3ljbGljIChuZWlnaGJvdXJob29kLCBzdGF0ZUNvdW50LCB0aHJlc2hvbGQsIGdyZWVuYmVyZ0hhc3RpbmdzTW9kZWwpIHtcbiAgICB2YXIgZ2xzbCA9IFtcbiAgICAgICAgZ2VuZXJhdGVHZXROZWlnaGJvdXJob29kQ29uZChuZWlnaGJvdXJob29kKSxcbiAgICAgICAgJycsXG4gICAgICAgICdpbnQgcHJvY2Vzcyhjb25zdCBpbiBpbnQgY3VycmVudFZhbHVlLCBjb25zdCBpbiB2ZWMyIHBvc2l0aW9uKSB7JyxcbiAgICAgICAgJyAgaW50IG5leHRWYWx1ZSA9IGludChtb2QoZmxvYXQoY3VycmVudFZhbHVlICsgMSksICcgKyBwcmludEZsb2F0KHN0YXRlQ291bnQpICsgJykpOycsXG4gICAgICAgICcgIGludCBzdW0gPSBnZXROZWlnaGJvdXJob29kQ29uZChwb3NpdGlvbiwgbmV4dFZhbHVlKTsnLFxuICAgICAgICAnICBpZiAoc3VtID49ICcgKyB0aHJlc2hvbGQgKyAoZ3JlZW5iZXJnSGFzdGluZ3NNb2RlbCA/ICcgfHwgY3VycmVudFZhbHVlID4gMCcgOiAnJykgKyAnKSB7JyxcbiAgICAgICAgJyAgICByZXR1cm4gbmV4dFZhbHVlOycsXG4gICAgICAgICcgIH0nLFxuICAgICAgICAnICByZXR1cm4gY3VycmVudFZhbHVlOycsXG4gICAgICAgICd9J1xuICAgIF07XG5cbiAgICByZXR1cm4gZ2xzbC5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVByb2Nlc3NHbHNsID0gZnVuY3Rpb24gZ2VuZXJhdGVQcm9jZXNzR2xzbCAobmVpZ2hib3VyaG9vZCxydWxlKSB7XG5cbiAgICBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnZGVidWcnKSB7XG4gICAgICAgIC8vIGRlYnVnIHByb2Nlc3MgZnVuY3Rpb25cbiAgICAgICAgdmFyIGdsc2wgPSBbXG4gICAgICAgICAgICAnaW50IHByb2Nlc3MoY29uc3QgaW50IGN1cnJlbnRWYWx1ZSwgY29uc3QgdmVjMiBwb3NpdGlvbikgeycsXG4gICAgICAgICAgICAnICBmbG9hdCBzcG9zaXRpb24gPSBmbG9hdChpbnQocG9zaXRpb24ueCkgKyBpbnQocG9zaXRpb24ueSkgKiBpbnQoaVRleHR1cmVTaXplLngpKTsnLFxuICAgICAgICAgICAgJyAgdmVjMyBwaXhlbFBvcyA9IHZlYzMoJyxcbiAgICAgICAgICAgICcgICAgbW9kKHNwb3NpdGlvbiwgaVJlYWxTaXplLngpLCcsXG4gICAgICAgICAgICAnICAgIG1vZChmbG9vcihzcG9zaXRpb24gLyBpU3RyaWRlWSksIGlSZWFsU2l6ZS55KSwnLFxuICAgICAgICAgICAgJyAgICBmbG9vcihzcG9zaXRpb24gLyBpU3RyaWRlWiknLFxuICAgICAgICAgICAgJyAgKTsnLFxuICAgICAgICAgICAgJyAgcmV0dXJuIGludChwaXhlbFBvcy55KTsnLFxuICAgICAgICAgICAgJ30nXG4gICAgICAgIF07XG5cbiAgICAgICAgcmV0dXJuIGdsc2wuam9pbignXFxuJyk7XG4gICAgfVxuXG5cbiAgICBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnbGlmZScgfHwgcnVsZS5ydWxlRm9ybWF0ID09PSAnZXh0ZW5kZWQtbGlmZScpIHtcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlUHJvY2Vzc0dsc2xMaWZlKG5laWdoYm91cmhvb2QsIHJ1bGUuc3Vydml2YWwsIHJ1bGUuYmlydGgpO1xuICAgIH0gZWxzZSBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnZXh0ZW5kZWQtc3RvY2hhc3RpYycpIHtcbiAgICAgICAgcmV0dXJuIGdlbmVyYXRlUHJvY2Vzc0dsc2xTdG9jaGFzdGljKG5laWdoYm91cmhvb2QsIHJ1bGUuc3Vydml2YWwsIHJ1bGUuYmlydGgpO1xuICAgIH0gZWxzZSBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnZ2VuZXJhdGlvbnMnIHx8IHJ1bGUucnVsZUZvcm1hdCA9PT0gJ2V4dGVuZGVkLWdlbmVyYXRpb25zJykge1xuICAgICAgICByZXR1cm4gZ2VuZXJhdGVQcm9jZXNzR2xzbEdlbmVyYXRpb25zKG5laWdoYm91cmhvb2QsIHJ1bGUuc3RhdGVDb3VudCwgcnVsZS5zdXJ2aXZhbCwgcnVsZS5iaXJ0aCk7XG4gICAgfSBlbHNlIGlmIChydWxlLnJ1bGVGb3JtYXQgPT09ICd2b3RlJykge1xuICAgICAgICByZXR1cm4gZ2VuZXJhdGVQcm9jZXNzR2xzbFZvdGUobmVpZ2hib3VyaG9vZCwgcnVsZS52b3RlKTtcbiAgICB9IGVsc2UgaWYgKHJ1bGUucnVsZUZvcm1hdCA9PT0gJ2x1a3knKSB7XG4gICAgICAgIHJldHVybiBnZW5lcmF0ZVByb2Nlc3NHbHNsTHVreShuZWlnaGJvdXJob29kLCBydWxlLmxvd1N1cnZpdmFsLCBydWxlLmhpZ2hTdXJ2aXZhbCwgcnVsZS5sb3dCaXJ0aCwgcnVsZS5oaWdoQmlydGgpO1xuICAgIH0gZWxzZSBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnbmx1a3knKSB7XG4gICAgICAgIHJldHVybiBnZW5lcmF0ZVByb2Nlc3NHbHNsTmx1a3kobmVpZ2hib3VyaG9vZCwgcnVsZS5zdGF0ZUNvdW50LCBydWxlLmxvd1N1cnZpdmFsLCBydWxlLmhpZ2hTdXJ2aXZhbCwgcnVsZS5sb3dCaXJ0aCwgcnVsZS5oaWdoQmlydGgpO1xuICAgIH0gZWxzZSBpZiAocnVsZS5ydWxlRm9ybWF0ID09PSAnY3ljbGljJykge1xuICAgICAgICByZXR1cm4gZ2VuZXJhdGVQcm9jZXNzR2xzbEN5Y2xpYyhuZWlnaGJvdXJob29kLCBydWxlLnN0YXRlQ291bnQsIHJ1bGUudGhyZXNob2xkLCBydWxlLmdyZWVuYmVyZ0hhc3RpbmdzTW9kZWwpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcignVW5zdXBwb3J0ZWQgcnVsZUZvcm1hdCA6ICcgKyBydWxlLnJ1bGVGb3JtYXQpO1xufTtcblxudmFyIGdlbmVyYXRlQ29tbWVudCA9IGZ1bmN0aW9uIGdlbmVyYXRlQ29tbWVudCAod2hhdCwgcnVsZSwgZGltZW5zaW9ucywgb3V0T2ZCb3VuZFZhbHVlKSB7XG4gICAgdmFyIGNvbW1lbnRzID0gW1xuICAgICAgICAnLyoqJyxcbiAgICAgICAgJyAqICcgKyB3aGF0ICsgJyBnZW5lcmF0ZWQgYnkgY2VsbHVsYXItYXV0b21hdGEtZ2xzbCAwLjEuMCcsXG4gICAgICAgICcgKicsXG4gICAgICAgICcgKiBSdWxlIDogJyArIHJ1bGUucnVsZVN0cmluZyxcbiAgICAgICAgJyAqIERpbWVuc2lvbnMgOiAnICsgZGltZW5zaW9ucy5sZW5ndGggKyAnRCBbJyArIGRpbWVuc2lvbnMuam9pbignLCAnKSArICddJyxcbiAgICAgICAgJyAqIE91dCBvZiBib3VuZCB2YWx1ZSA6ICcgKyBvdXRPZkJvdW5kVmFsdWUsXG4gICAgICAgICcgKi8nXG4gICAgXTtcblxuICAgIHJldHVybiBjb21tZW50cy5qb2luKCdcXG4nKTtcbn07XG5cbnZhciBnZW5lcmF0ZVVuaWZvcm1zQW5kQ29uc3RhbnRzID0gZnVuY3Rpb24gZ2VuZXJhdGVVbmlmb3Jtc0FuZENvbnN0YW50cyAoZGltZW5zaW9ucywgdGV4dHVyZVdpZHRoLCB0ZXh0dXJlSGVpZ2h0KSB7XG4gICAgcmV0dXJuIFtcbiAgICAgICAgJ2NvbnN0IHZlYzMgaVJlYWxTaXplID0gdmVjMygnICsgZGltZW5zaW9uc1swXSArICcsICcgKyBkaW1lbnNpb25zWzFdICsgJywgJyArIGRpbWVuc2lvbnNbMl0gKyAnKTsnLFxuICAgICAgICAnY29uc3QgdmVjMiBpVGV4dHVyZVNpemUgPSB2ZWMyKCcgKyB0ZXh0dXJlV2lkdGggKyAnLCAnICsgdGV4dHVyZUhlaWdodCArICcpOycsXG4gICAgICAgICdjb25zdCBmbG9hdCBpU3RyaWRlWSA9ICcgKyBwcmludEZsb2F0KGRpbWVuc2lvbnNbMF0pICsgJzsnLFxuICAgICAgICAnY29uc3QgZmxvYXQgaVN0cmlkZVogPSAnICsgcHJpbnRGbG9hdChkaW1lbnNpb25zWzBdICogZGltZW5zaW9uc1sxXSkgKyAnOycsXG4gICAgICAgICdjb25zdCBmbG9hdCBpTWF4UG9zID0gJyArIHByaW50RmxvYXQoZGltZW5zaW9uc1swXSAqIGRpbWVuc2lvbnNbMV0gKiBkaW1lbnNpb25zWzJdKSArICc7JyxcbiAgICAgICAgJ3VuaWZvcm0gc2FtcGxlcjJEIGlCYWNrYnVmZmVyOycsXG4gICAgICAgICd1bmlmb3JtIGZsb2F0IGlGcmFtZTsnXG4gICAgXS5qb2luKCdcXG4nKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2VuZXJhdGVTaGFkZXJzKHJ1bGUsIG5laWdoYm91cmhvb2QsIGRpbWVuc2lvbnMsIHdpZHRoLCBoZWlnaHQsIG91dE9mQm91bmRWYWx1ZSkge1xuICAgIGlmIChkaW1lbnNpb25zLmxlbmd0aCAhPT0gMykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0RvZXMgbm90IHN1cHBvcnQgb3RoZXIgZGltZW5zaW9uIHRoYW4gM0QnKTtcbiAgICB9XG5cbiAgICB2YXIgZnJhZ21lbnRHbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUNvbW1lbnQoJ0ZyYWdtZW50IHNoYWRlcicsIHJ1bGUsIGRpbWVuc2lvbnMsIG91dE9mQm91bmRWYWx1ZSksXG4gICAgICAgICcnLFxuICAgICAgICAnI2lmZGVmIEdMX0VTJyxcbiAgICAgICAgJyNpZiBHTF9GUkFHTUVOVF9QUkVDSVNJT05fSElHSCA9PSAxJyxcbiAgICAgICAgJyAgcHJlY2lzaW9uIGhpZ2hwIGZsb2F0OycsXG4gICAgICAgICcgIHByZWNpc2lvbiBoaWdocCBpbnQ7JyxcbiAgICAgICAgJyAgcHJlY2lzaW9uIGhpZ2hwIHNhbXBsZXIyRDsnLFxuICAgICAgICAnI2Vsc2UnLFxuICAgICAgICAnICBwcmVjaXNpb24gbWVkaXVtcCBmbG9hdDsnLFxuICAgICAgICAnICBwcmVjaXNpb24gbWVkaXVtcCBpbnQ7JyxcbiAgICAgICAgJyAgcHJlY2lzaW9uIG1lZGl1bXAgc2FtcGxlcjJEOycsXG4gICAgICAgICcjZW5kaWYnLFxuICAgICAgICAnI2VuZGlmJyxcbiAgICAgICAgJycsXG4gICAgICAgIGdlbmVyYXRlVW5pZm9ybXNBbmRDb25zdGFudHMoZGltZW5zaW9ucywgd2lkdGgsIGhlaWdodCksXG4gICAgICAgICcnLFxuICAgICAgICAnaW50IHVucGFja1ZhbHVlKGNvbnN0IGluIGZsb2F0IHBhY2tlZFZhbHVlKSB7JyxcbiAgICAgICAgJyByZXR1cm4gaW50KChwYWNrZWRWYWx1ZSAqIDI1NS4pICsgMC41KTsnLFxuICAgICAgICAnfScsXG4gICAgICAgICcnLFxuICAgICAgICAnZmxvYXQgcGFja1ZhbHVlKGNvbnN0IGluIGludCB1bnBhY2tlZFZhbHVlKSB7JyxcbiAgICAgICAgJyByZXR1cm4gZmxvYXQodW5wYWNrZWRWYWx1ZSkgLyAyNTUuOycsXG4gICAgICAgICd9JyxcbiAgICAgICAgJycsXG4gICAgICAgIGdlbmVyYXRlR2V0UG9zVGV4dCgpLFxuICAgICAgICAnJyxcbiAgICAgICAgZ2VuZXJhdGVHZXRQaXhlbEdsc2wob3V0T2ZCb3VuZFZhbHVlKSxcbiAgICAgICAgJycsXG4gICAgICAgIGdlbmVyYXRlUHJvY2Vzc0dsc2wobmVpZ2hib3VyaG9vZCwgcnVsZSksXG4gICAgICAgICcnLFxuICAgICAgICAndm9pZCBtYWluKCkgeycsXG4gICAgICAgICcgIGludCBjdXJyZW50VmFsdWUgPSB1bnBhY2tWYWx1ZSh0ZXh0dXJlMkQoaUJhY2tidWZmZXIsIGdsX0ZyYWdDb29yZC54eSAvIGlUZXh0dXJlU2l6ZSkucik7JyxcbiAgICAgICAgJyAgZ2xfRnJhZ0NvbG9yID0gdmVjNChwYWNrVmFsdWUocHJvY2VzcyhjdXJyZW50VmFsdWUsIGdsX0ZyYWdDb29yZC54eSkpKTsnLFxuICAgICAgICAnfScsXG4gICAgICAgICcnXG4gICAgXTtcblxuICAgIHZhciB2ZXJ0ZXhHbHNsID0gW1xuICAgICAgICBnZW5lcmF0ZUNvbW1lbnQoJ1ZlcnRleCBzaGFkZXInLCBydWxlLCBkaW1lbnNpb25zLCBvdXRPZkJvdW5kVmFsdWUpLFxuICAgICAgICAnJyxcbiAgICAgICAgJ2F0dHJpYnV0ZSB2ZWMzIGFWZXJ0ZXhQb3NpdGlvbjsnLFxuICAgICAgICAndm9pZCBtYWluKCkgeycsXG4gICAgICAgICcgIGdsX1Bvc2l0aW9uID0gdmVjNChhVmVydGV4UG9zaXRpb24sIDEuMCk7JyxcbiAgICAgICAgJ30nLFxuICAgICAgICAnJ1xuICAgIF07XG5cbiAgICAvL2NvbnNvbGUubG9nKGZyYWdtZW50R2xzbC5qb2luKCdcXG4nKSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICB2ZXJ0ZXhTaGFkZXI6IHZlcnRleEdsc2wuam9pbignXFxuJyksXG4gICAgICAgIGZyYWdtZW50U2hhZGVyOiBmcmFnbWVudEdsc2wuam9pbignXFxuJylcbiAgICB9O1xufTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgZ2V0Q29udGV4dCA9IHJlcXVpcmUoJy4vZ2wtY29udGV4dCcpO1xuXG4vKipcbiAqIENyZWF0ZSB0aGUgc3VyZmFjZSB0byBkcmF3IG9udG9cbiAqIEBwYXJhbSB7V2ViR0xSZW5kZXJpbmdDb250ZXh0fSBjb250ZXh0XG4gKiBAcmV0dXJucyB7V2ViR0xCdWZmZXJ9IEJ1ZmZlciBvZiB0aGUgc3VyZmFjZVxuICovXG52YXIgY3JlYXRlQnVmZmVyID0gZnVuY3Rpb24gY3JlYXRlQnVmZmVyKGNvbnRleHQpIHtcbiAgICB2YXIgdHJpYW5nbGVWZXJ0ZXhQb3NpdGlvbkJ1ZmZlciA9IGNvbnRleHQuY3JlYXRlQnVmZmVyKCk7XG4gICAgY29udGV4dC5iaW5kQnVmZmVyKGNvbnRleHQuQVJSQVlfQlVGRkVSLCB0cmlhbmdsZVZlcnRleFBvc2l0aW9uQnVmZmVyKTtcbiAgICBjb250ZXh0LmJ1ZmZlckRhdGEoY29udGV4dC5BUlJBWV9CVUZGRVIsIG5ldyBGbG9hdDMyQXJyYXkoWy0xLCAtMSwgLTEsIDQsIDQsIC0xXSksIGNvbnRleHQuU1RBVElDX0RSQVcpO1xuICAgIHRyaWFuZ2xlVmVydGV4UG9zaXRpb25CdWZmZXIuaXRlbVNpemUgPSAyO1xuICAgIHRyaWFuZ2xlVmVydGV4UG9zaXRpb25CdWZmZXIubnVtSXRlbXMgPSAzO1xuXG4gICAgcmV0dXJuIHRyaWFuZ2xlVmVydGV4UG9zaXRpb25CdWZmZXI7XG59O1xuXG4vKipcbiAqIENyZWF0ZSBhIHRhcmdldCBmb3IgcmVuZGVyaW5nXG4gKiBAcGFyYW0ge1dlYkdMUmVuZGVyaW5nQ29udGV4dH0gY29udGV4dFxuICogQHBhcmFtIHtpbnR9IHdpZHRoXG4gKiBAcGFyYW0ge2ludH0gaGVpZ2h0XG4gKiBAcmV0dXJucyB7e3RleHR1cmU6IFdlYkdMVGV4dHVyZSwgZnJhbWVidWZmZXI6IFdlYkdMRnJhbWVCdWZmZXJ9fVxuICovXG52YXIgY3JlYXRlVGFyZ2V0ID0gZnVuY3Rpb24gY3JlYXRlVGFyZ2V0KGNvbnRleHQsIHdpZHRoLCBoZWlnaHQpIHtcbiAgICB2YXIgdGFyZ2V0ID0ge1xuICAgICAgICB0ZXh0dXJlIDogY29udGV4dC5jcmVhdGVUZXh0dXJlKCksXG4gICAgICAgIGZyYW1lYnVmZmVyIDogY29udGV4dC5jcmVhdGVGcmFtZWJ1ZmZlcigpXG4gICAgfTtcblxuICAgIGNvbnRleHQuYmluZFRleHR1cmUoY29udGV4dC5URVhUVVJFXzJELCB0YXJnZXQudGV4dHVyZSk7XG4gICAgY29udGV4dC50ZXhJbWFnZTJEKGNvbnRleHQuVEVYVFVSRV8yRCwgMCwgY29udGV4dC5SR0JBLCB3aWR0aCwgaGVpZ2h0LCAwLCBjb250ZXh0LlJHQkEsIGNvbnRleHQuVU5TSUdORURfQllURSwgbnVsbCk7XG5cbiAgICBjb250ZXh0LnRleFBhcmFtZXRlcmkoY29udGV4dC5URVhUVVJFXzJELCBjb250ZXh0LlRFWFRVUkVfV1JBUF9TLCBjb250ZXh0LkNMQU1QX1RPX0VER0UpO1xuICAgIGNvbnRleHQudGV4UGFyYW1ldGVyaShjb250ZXh0LlRFWFRVUkVfMkQsIGNvbnRleHQuVEVYVFVSRV9XUkFQX1QsIGNvbnRleHQuQ0xBTVBfVE9fRURHRSk7XG4gICAgY29udGV4dC50ZXhQYXJhbWV0ZXJpKGNvbnRleHQuVEVYVFVSRV8yRCwgY29udGV4dC5URVhUVVJFX01BR19GSUxURVIsIGNvbnRleHQuTkVBUkVTVCk7XG4gICAgY29udGV4dC50ZXhQYXJhbWV0ZXJpKGNvbnRleHQuVEVYVFVSRV8yRCwgY29udGV4dC5URVhUVVJFX01JTl9GSUxURVIsIGNvbnRleHQuTkVBUkVTVCk7XG5cbiAgICBjb250ZXh0LmJpbmRGcmFtZWJ1ZmZlcihjb250ZXh0LkZSQU1FQlVGRkVSLCB0YXJnZXQuZnJhbWVidWZmZXIpO1xuICAgIGNvbnRleHQuZnJhbWVidWZmZXJUZXh0dXJlMkQoY29udGV4dC5GUkFNRUJVRkZFUiwgY29udGV4dC5DT0xPUl9BVFRBQ0hNRU5UMCwgY29udGV4dC5URVhUVVJFXzJELCB0YXJnZXQudGV4dHVyZSwgMCk7XG5cbiAgICBjb250ZXh0LmJpbmRUZXh0dXJlKGNvbnRleHQuVEVYVFVSRV8yRCwgbnVsbCk7XG4gICAgY29udGV4dC5iaW5kRnJhbWVidWZmZXIoY29udGV4dC5GUkFNRUJVRkZFUiwgbnVsbCk7XG5cbiAgICByZXR1cm4gdGFyZ2V0O1xufTtcblxuLyoqXG4gKiBDcmVhdGUgYSBzaGFkZXJcbiAqIEBwYXJhbSB7V2ViR0xSZW5kZXJpbmdDb250ZXh0fSBjb250ZXh0XG4gKiBAcGFyYW0ge2ludH0gdHlwZSBGUkFHTUVOVF9TSEFERVIgb3IgVkVSVEVYX1NIQURFUlxuICogQHBhcmFtIHtzdHJpbmd9IHNyYyBTb3VyY2Ugb2YgdGhlIHNoYWRlclxuICogQHJldHVybnMge1dlYkdMU2hhZGVyfVxuICovXG52YXIgY3JlYXRlU2hhZGVyID0gZnVuY3Rpb24gY3JlYXRlU2hhZGVyKGNvbnRleHQsIHR5cGUsIHNyYykge1xuICAgIHZhciBzaGFkZXIgPSBjb250ZXh0LmNyZWF0ZVNoYWRlcih0eXBlKTtcbiAgICBjb250ZXh0LnNoYWRlclNvdXJjZSggc2hhZGVyLCBzcmMgKTtcbiAgICBjb250ZXh0LmNvbXBpbGVTaGFkZXIoIHNoYWRlciApO1xuXG4gICAgaWYgKCFjb250ZXh0LmdldFNoYWRlclBhcmFtZXRlcihzaGFkZXIsIGNvbnRleHQuQ09NUElMRV9TVEFUVVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRXJyb3IgY3JlYXRpbmcgc2hhZGVyIDogJyArIGNvbnRleHQuZ2V0U2hhZGVySW5mb0xvZyhzaGFkZXIpICsgJ1xcbicgKyBzcmMpO1xuICAgIH1cblxuICAgIHJldHVybiBzaGFkZXI7XG59O1xuXG4vKipcbiAqIENyZWF0ZSBhIHByb2dyYW1cbiAqIEBwYXJhbSB7V2ViR0xSZW5kZXJpbmdDb250ZXh0fSBjb250ZXh0XG4gKiBAcGFyYW0ge3t2ZXJ0ZXhTaGFkZXI6c3RyaW5nLCBmcmFnbWVudFNoYWRlcjpzdHJpbmd9fSBzaGFkZXJzXG4gKiBAcmV0dXJucyB7V2ViR0xQcm9ncmFtfVxuICovXG52YXIgY3JlYXRlUHJvZ3JhbSA9IGZ1bmN0aW9uIGNyZWF0ZVByb2dyYW0oY29udGV4dCwgc2hhZGVycykge1xuICAgIHZhciBzaGFkZXJQcm9ncmFtID0gY29udGV4dC5jcmVhdGVQcm9ncmFtKCksXG4gICAgICAgIHZlcnRleFNoYWRlciA9IGNyZWF0ZVNoYWRlcihjb250ZXh0LCBjb250ZXh0LlZFUlRFWF9TSEFERVIsIHNoYWRlcnMudmVydGV4U2hhZGVyKSxcbiAgICAgICAgZnJhZ21lbnRTaGFkZXIgPSBjcmVhdGVTaGFkZXIoY29udGV4dCwgY29udGV4dC5GUkFHTUVOVF9TSEFERVIsIHNoYWRlcnMuZnJhZ21lbnRTaGFkZXIgKTtcblxuICAgIGNvbnRleHQuYXR0YWNoU2hhZGVyKHNoYWRlclByb2dyYW0sIHZlcnRleFNoYWRlcik7XG4gICAgY29udGV4dC5hdHRhY2hTaGFkZXIoc2hhZGVyUHJvZ3JhbSwgZnJhZ21lbnRTaGFkZXIpO1xuXG4gICAgY29udGV4dC5saW5rUHJvZ3JhbShzaGFkZXJQcm9ncmFtKTtcblxuICAgIGlmICghY29udGV4dC5nZXRQcm9ncmFtUGFyYW1ldGVyKHNoYWRlclByb2dyYW0sIGNvbnRleHQuTElOS19TVEFUVVMpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGluaXRpYWxpc2Ugc2hhZGVycycpO1xuICAgIH1cblxuICAgIHNoYWRlclByb2dyYW0udmVydGV4UG9zaXRpb25BdHRyaWJ1dGUgPSBjb250ZXh0LmdldEF0dHJpYkxvY2F0aW9uKHNoYWRlclByb2dyYW0sICdhVmVydGV4UG9zaXRpb24nKTtcbiAgICBjb250ZXh0LmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KHNoYWRlclByb2dyYW0udmVydGV4UG9zaXRpb25BdHRyaWJ1dGUpO1xuICAgIHNoYWRlclByb2dyYW0uaUJhY2tidWZmZXIgPSBjb250ZXh0LmdldFVuaWZvcm1Mb2NhdGlvbihzaGFkZXJQcm9ncmFtLCAnaUJhY2tidWZmZXInKTtcbiAgICBzaGFkZXJQcm9ncmFtLmlGcmFtZSA9IGNvbnRleHQuZ2V0VW5pZm9ybUxvY2F0aW9uKHNoYWRlclByb2dyYW0sICdpRnJhbWUnKTtcblxuICAgIHJldHVybiBzaGFkZXJQcm9ncmFtO1xufTtcblxuLyoqXG4gKiBJbml0aWFsaXplIGEgV2ViR0wtYmFzZWQgYmFja2VuZFxuICogQHBhcmFtIHtBcnJheX0gc2hhcGVcbiAqIEBjb25zdHJ1Y3RvclxuICovXG52YXIgR3B1QmFja2VuZCA9IGZ1bmN0aW9uIEdwdUJhY2tlbmQgKHNoYXBlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gZ2V0Q29udGV4dChudWxsLCBudWxsLCB7XG4gICAgICAgIGFscGhhOiBmYWxzZSxcbiAgICAgICAgZGVwdGg6IGZhbHNlLFxuICAgICAgICBzdGVuY2lsOiBmYWxzZSxcbiAgICAgICAgYW50aWFsaWFzOiBmYWxzZSxcbiAgICAgICAgcHJlc2VydmVEcmF3aW5nQnVmZmVyOiBmYWxzZVxuICAgIH0pO1xuXG4gICAgdGhpcy5jb250ZXh0LmdsLmRpc2FibGUodGhpcy5jb250ZXh0LmdsLkRFUFRIX1RFU1QpO1xuICAgIHRoaXMuY29udGV4dC5nbC5kaXNhYmxlKHRoaXMuY29udGV4dC5nbC5ESVRIRVIpO1xuXG4gICAgdGhpcy5zZXRTaGFwZShzaGFwZSk7XG59O1xuXG5HcHVCYWNrZW5kLnByb3RvdHlwZS5zaGFwZSA9IG51bGw7XG5HcHVCYWNrZW5kLnByb3RvdHlwZS5kaW1lbnNpb24gPSBudWxsO1xuR3B1QmFja2VuZC5wcm90b3R5cGUudmlld3BvcnRXaWR0aCA9IG51bGw7XG5HcHVCYWNrZW5kLnByb3RvdHlwZS52aWV3cG9ydEhlaWdodCA9IG51bGw7XG5cbkdwdUJhY2tlbmQucHJvdG90eXBlLmNhbnZhcyA9IG51bGw7XG5HcHVCYWNrZW5kLnByb3RvdHlwZS5jb250ZXh0ID0gbnVsbDtcbkdwdUJhY2tlbmQucHJvdG90eXBlLnRyaWFuZ2xlID0gbnVsbDtcblxuR3B1QmFja2VuZC5wcm90b3R5cGUucmdiYVRleHR1cmVEYXRhID0gbnVsbDtcbkdwdUJhY2tlbmQucHJvdG90eXBlLmZyb250VGFyZ2V0ID0gbnVsbDtcbkdwdUJhY2tlbmQucHJvdG90eXBlLmJhY2tUYXJnZXQgPSBudWxsO1xuXG4vKipcbiAqIFNldCB0aGUgc2hhcGVcbiAqIEBwYXJhbSB7QXJyYXl9IHNoYXBlXG4gKiBAcHJvdGVjdGVkXG4gKi9cbkdwdUJhY2tlbmQucHJvdG90eXBlLnNldFNoYXBlID0gZnVuY3Rpb24gKHNoYXBlKSB7XG4gICAgdmFyIGdsID0gdGhpcy5jb250ZXh0LmdsO1xuXG4gICAgdGhpcy5zaGFwZSA9IHNoYXBlO1xuICAgIHRoaXMuZGltZW5zaW9uID0gc2hhcGUubGVuZ3RoO1xuXG4gICAgaWYgKHRoaXMuZGltZW5zaW9uID09PSAyKSB7XG4gICAgICAgIHRoaXMudmlld3BvcnRXaWR0aCA9IHNoYXBlWzBdO1xuICAgICAgICB0aGlzLnZpZXdwb3J0SGVpZ2h0ID0gc2hhcGVbMV07XG4gICAgfSBlbHNlIGlmICh0aGlzLmRpbWVuc2lvbiA9PT0gMykge1xuICAgICAgICAvL1RPRE8gaXQgc2hvdWxkIGJlIHBvc3NpYmxlIHRvIG9wdGltaXplIHRoZSB0b3RhbCBudW1iZXIgb2YgcGl4ZWxzIHVzaW5nIGEgcmVjdGFuZ3VsYXIgdGV4dHVyZSBpbnN0ZWFkIG9mIGEgc3F1YXJlIG9uZVxuICAgICAgICB0aGlzLnZpZXdwb3J0V2lkdGggPSB0aGlzLnZpZXdwb3J0SGVpZ2h0ID0gTWF0aC5jZWlsKE1hdGguc3FydChzaGFwZVswXSAqIHNoYXBlWzFdICogc2hhcGVbMl0pKTtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRleHQucmVzaXplKHRoaXMudmlld3BvcnRXaWR0aCwgdGhpcy52aWV3cG9ydEhlaWdodCk7XG5cbiAgICB0aGlzLnJnYmFUZXh0dXJlRGF0YSA9IG5ldyBVaW50OEFycmF5KHRoaXMudmlld3BvcnRXaWR0aCAqIHRoaXMudmlld3BvcnRIZWlnaHQgKiA0KTtcbiAgICB0aGlzLmZyb250VGFyZ2V0ID0gY3JlYXRlVGFyZ2V0KGdsLCB0aGlzLnZpZXdwb3J0V2lkdGgsIHRoaXMudmlld3BvcnRIZWlnaHQpO1xuICAgIHRoaXMuYmFja1RhcmdldCA9IGNyZWF0ZVRhcmdldChnbCwgdGhpcy52aWV3cG9ydFdpZHRoLCB0aGlzLnZpZXdwb3J0SGVpZ2h0KTtcbiAgICB0aGlzLnRyaWFuZ2xlID0gY3JlYXRlQnVmZmVyKGdsKTtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSBhIGdpdmVuIHJ1bGUgZm9yIGFsbCBpdHMgaXRlcmF0aW9uc1xuICogQHBhcmFtIHtvYmplY3R9IHJ1bGVcbiAqIEBwdWJsaWNcbiAqL1xuR3B1QmFja2VuZC5wcm90b3R5cGUuZXhlY3V0ZSA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgdmFyIHNoYWRlcnMgPSBydWxlLnNoYWRlcnMsXG4gICAgICAgIGl0ZXJhdGlvbiA9IHJ1bGUuaXRlcmF0aW9uLFxuICAgICAgICBnbCA9IHRoaXMuY29udGV4dC5nbCxcbiAgICAgICAgc2hhZGVyUHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oZ2wsIHNoYWRlcnMpO1xuXG4gICAgLy8gc2V0IGl0ZXJhdGlvbi1pbmRlcGVuZGVudCBnbCBzZXR0aW5nc1xuICAgIGdsLnZpZXdwb3J0KDAsIDAsIGdsLmRyYXdpbmdCdWZmZXJXaWR0aCwgZ2wuZHJhd2luZ0J1ZmZlckhlaWdodCk7XG4gICAgZ2wudXNlUHJvZ3JhbShzaGFkZXJQcm9ncmFtKTtcbiAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgdGhpcy50cmlhbmdsZSk7XG4gICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcihzaGFkZXJQcm9ncmFtLnZlcnRleFBvc2l0aW9uQXR0cmlidXRlLCB0aGlzLnRyaWFuZ2xlLml0ZW1TaXplLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApO1xuICAgIGdsLnVuaWZvcm0xaShzaGFkZXJQcm9ncmFtLmlCYWNrYnVmZmVyLCAwKTtcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaXRlcmF0aW9uOyBpKyspIHtcbiAgICAgICAgdGhpcy5zd2FwUmVuZGVyaW5nVGFyZ2V0cygpO1xuICAgICAgICB0aGlzLmV4ZWN1dGVQcm9ncmFtKHNoYWRlclByb2dyYW0sIGkpO1xuICAgIH1cbn07XG5cbi8qKlxuICogU3dhcCB0aGUgZnJvbnQgYW5kIHRoZSBiYWNrIHRhcmdldFxuICogQHByb3RlY3RlZFxuICovXG5HcHVCYWNrZW5kLnByb3RvdHlwZS5zd2FwUmVuZGVyaW5nVGFyZ2V0cyA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgdG1wID0gdGhpcy5mcm9udFRhcmdldDtcbiAgICB0aGlzLmZyb250VGFyZ2V0ID0gdGhpcy5iYWNrVGFyZ2V0O1xuICAgIHRoaXMuYmFja1RhcmdldCA9IHRtcDtcbn07XG5cbi8qKlxuICogRXhlY3V0ZSBhIGdpdmVuIFdlYkdMUHJvZ3JhbSBvbmNlXG4gKiBAcGFyYW0ge1dlYkdMUHJvZ3JhbX0gc2hhZGVyUHJvZ3JhbVxuICogQHBhcmFtIHtpbnR9IGl0ZXJhdGlvblxuICogQHByb3RlY3RlZFxuICovXG5HcHVCYWNrZW5kLnByb3RvdHlwZS5leGVjdXRlUHJvZ3JhbSA9IGZ1bmN0aW9uIChzaGFkZXJQcm9ncmFtLCBpdGVyYXRpb24pIHtcbiAgICB2YXIgZ2wgPSB0aGlzLmNvbnRleHQuZ2w7XG5cbiAgICAvLyBzZXQgaUZyYW1lIHVuaWZvcm1cbiAgICBnbC51bmlmb3JtMWYoc2hhZGVyUHJvZ3JhbS5pRnJhbWUsIGl0ZXJhdGlvbik7XG5cbiAgICAvLyBzZXQgYmFja2J1ZmZlclxuICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApO1xuICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIHRoaXMuYmFja1RhcmdldC50ZXh0dXJlKTtcblxuICAgIC8vIHJlbmRlciB0byBmcm9udCBidWZmZXJcbiAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIHRoaXMuZnJvbnRUYXJnZXQuZnJhbWVidWZmZXIpO1xuICAgIGdsLmRyYXdBcnJheXMoZ2wuVFJJQU5HTEVTLCAwLCB0aGlzLnRyaWFuZ2xlLm51bUl0ZW1zKTtcbn07XG5cbi8qKlxuICogUmVhZCB0aGUgY3VycmVudCBzdGF0ZSBmcm9tIHRoZSB0ZXh0dXJlXG4gKiBAcGFyYW0ge29iamVjdH0gbmRhcnJheSBJbnN0YW5jZSBvZiBuZGFycmF5XG4gKiBAcHVibGljXG4gKi9cbkdwdUJhY2tlbmQucHJvdG90eXBlLnJlYWQgPSBmdW5jdGlvbiAobmRhcnJheSkge1xuICAgIHZhciBnbCA9IHRoaXMuY29udGV4dC5nbCxcbiAgICAgICAgZGF0YSA9IHRoaXMucmdiYVRleHR1cmVEYXRhLFxuICAgICAgICBwcm9jZXNzZWREYXRhID0gW10sXG4gICAgICAgIGksXG4gICAgICAgIGwsXG4gICAgICAgIHgsXG4gICAgICAgIHksXG4gICAgICAgIHo7XG5cbiAgICBnbC5yZWFkUGl4ZWxzKDAsIDAsIHRoaXMudmlld3BvcnRXaWR0aCwgdGhpcy52aWV3cG9ydEhlaWdodCwgZ2wuUkdCQSwgZ2wuVU5TSUdORURfQllURSwgZGF0YSk7XG5cbiAgICBpZiAodGhpcy5kaW1lbnNpb24gPT09IDIpIHtcbiAgICAgICAgZm9yKGkgPSAwLCBsID0gZGF0YS5sZW5ndGggLyA0OyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB4ID0gaSAlIHRoaXMuc2hhcGVbMF07XG4gICAgICAgICAgICB5ID0gTWF0aC5mbG9vcihpIC8gdGhpcy5zaGFwZVswXSk7XG5cbiAgICAgICAgICAgIG5kYXJyYXkuc2V0KHgsIHksIGRhdGFbaSAqIDRdKTtcbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGZvcihpID0gMCwgbCA9IGRhdGEubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICB4ID0gaSAlIHRoaXMuc2hhcGVbMF07XG4gICAgICAgICAgICB5ID0gTWF0aC5mbG9vcihpIC8gdGhpcy5zaGFwZVswXSkgJSB0aGlzLnNoYXBlWzFdO1xuICAgICAgICAgICAgeiA9IE1hdGguZmxvb3IoaSAvICh0aGlzLnNoYXBlWzBdICogdGhpcy5zaGFwZVsxXSkpO1xuXG4gICAgICAgICAgICBpZiAoeiA+PSB0aGlzLnNoYXBlWzJdKSBicmVhaztcblxuICAgICAgICAgICAgbmRhcnJheS5zZXQoeCwgeSwgeiwgZGF0YVtpICogNF0pO1xuXG4gICAgICAgICAgICAvKlxuICAgICAgICAgICAgaWYgKGRhdGFbaSAqIDRdKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coeCwgeSwgeiwgbmRhcnJheS5nZXQoeCwgeSwgeikpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgKi9cbiAgICAgICAgfVxuICAgIH1cblxufTtcblxuLyoqXG4gKiBXcml0ZSB0aGUgY3VycmVudCBzdGF0ZSB0byB0aGUgdGV4dHVyZVxuICogQHBhcmFtIHtvYmplY3R9IG5kYXJyYXkgSW5zdGFuY2Ugb2YgbmRhcnJheVxuICogQHB1YmxpY1xuICovXG5HcHVCYWNrZW5kLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChuZGFycmF5KSB7XG4gICAgdmFyIHNoYXBlID0gdGhpcy5zaGFwZSxcbiAgICAgICAgZGF0YSA9IHRoaXMucmdiYVRleHR1cmVEYXRhLFxuICAgICAgICBnbCA9IHRoaXMuY29udGV4dC5nbCxcbiAgICAgICAgeCxcbiAgICAgICAgeSxcbiAgICAgICAgeixcbiAgICAgICAgaTtcblxuICAgIGlmICh0aGlzLmRpbWVuc2lvbiA9PT0gMikge1xuICAgICAgICBmb3IgKHkgPSAwOyB5IDwgc2hhcGVbMV07IHkrKykge1xuICAgICAgICAgICAgZm9yICh4ID0gMDsgeCA8IHNoYXBlWzBdOyB4KyspIHtcbiAgICAgICAgICAgICAgICBpID0gKHggKyB5ICogc2hhcGVbMF0pICogNDtcblxuICAgICAgICAgICAgICAgIGRhdGFbaV0gPSBkYXRhW2kgKyAxXSA9IGRhdGFbaSArIDJdID0gZGF0YVtpICsgM10gPSBuZGFycmF5LmdldCh4LCB5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoeiA9IDA7IHogPCBzaGFwZVsyXTsgeisrKSB7XG4gICAgICAgICAgICBmb3IgKHkgPSAwOyB5IDwgc2hhcGVbMV07IHkrKykge1xuICAgICAgICAgICAgICAgIGZvciAoeCA9IDA7IHggPCBzaGFwZVswXTsgeCsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGkgPSAoeCArICh5ICogc2hhcGVbMF0pICsgKHogKiBzaGFwZVswXSAqIHNoYXBlWzFdKSkgKiA0O1xuXG4gICAgICAgICAgICAgICAgICAgIGRhdGFbaV0gPSBkYXRhW2kgKyAxXSA9IGRhdGFbaSArIDJdID0gZGF0YVtpICsgM10gPSBuZGFycmF5LmdldCh4LCB5LCB6KTtcbiAgICAgICAgICAgICAgICAgICAgLy9jb25zb2xlLmxvZyhkYXRhLmxlbmd0aCwgaSAvIDQsIGRhdGFbaV0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vY29uc29sZS5sb2coZGF0YSk7XG5cbiAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCB0aGlzLmZyb250VGFyZ2V0LnRleHR1cmUpO1xuICAgIGdsLnRleEltYWdlMkQoZ2wuVEVYVFVSRV8yRCwgMCwgZ2wuUkdCQSwgdGhpcy52aWV3cG9ydFdpZHRoLCB0aGlzLnZpZXdwb3J0SGVpZ2h0LCAwLCBnbC5SR0JBLCBnbC5VTlNJR05FRF9CWVRFLCBkYXRhKTtcbiAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCBudWxsKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gR3B1QmFja2VuZDtcbiIsIihmdW5jdGlvbiAocHJvY2Vzcyl7XG5cInVzZSBzdHJpY3RcIjtcblxudmFyIGlzTm9kZSA9ICEhKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLnZlcnNpb25zICYmIHByb2Nlc3MudmVyc2lvbnMubm9kZSksXG4gICAgaXNXZWIgPSAhISh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgZG9jdW1lbnQgPT09ICdvYmplY3QnKSxcbiAgICBpc1dvcmtlciA9ICEhKHR5cGVvZiBXb3JrZXJHbG9iYWxTY29wZSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHNlbGYgPT09ICdvYmplY3QnICYmIHNlbGYgaW5zdGFuY2VvZiBXb3JrZXJHbG9iYWxTY29wZSksXG4gICAgaGFzT2Zmc2NyZWVuQ2FudmFzID0gISEodHlwZW9mIE9mZnNjcmVlbkNhbnZhcyAhPT0gJ3VuZGVmaW5lZCcpO1xuXG4vKipcbiAqIFRyeSB0byByZXRyaWV2ZSBhbiBoZWFkbGVzcyBXZWJHTFJlbmRlcmluZ0NvbnRleHRcbiAqIEBwYXJhbSB7aW50fSB3aWR0aFxuICogQHBhcmFtIHtpbnR9IGhlaWdodFxuICogQHBhcmFtIHtvYmplY3R9IGdsT3B0aW9uc1xuICogQHJldHVybnMge3tjYW52YXM6ICosIGdsOiBXZWJHTFJlbmRlcmluZ0NvbnRleHQsIHJlc2l6ZTogRnVuY3Rpb259fSBPYmplY3Qgd2l0aCBjYW52YXMsIGdsIGNvbnRleHQgYW5kIHN0YW5kYXJkaXplZCByZXNpemUgZnVuY3Rpb24uXG4gKi9cbnZhciBnZXRIZWFkbGVzc0dsQ29udGV4dCA9IGZ1bmN0aW9uIGdldEhlYWRsZXNzR2xDb250ZXh0ICh3aWR0aCwgaGVpZ2h0LCBnbE9wdGlvbnMpIHtcbiAgICB2YXIgY29udGV4dDtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnRleHQgPSByZXF1aXJlKCdnbCcpKHdpZHRoLCBoZWlnaHQsIGdsT3B0aW9ucyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCBpbml0aWFsaXplIGhlYWRsZXNzIFdlYkdMUmVuZGVyaW5nQ29udGV4dCA6ICcgKyBlLm1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIGNhbnZhczogbnVsbCxcbiAgICAgICAgZ2w6IGNvbnRleHQsXG4gICAgICAgIHJlc2l6ZTogZnVuY3Rpb24gKHdpZHRoLCBoZWlnaHQpIHtcbiAgICAgICAgICAgIHRoaXMuZ2wucmVzaXplKHdpZHRoLCBoZWlnaHQpO1xuICAgICAgICB9XG4gICAgfTtcbn07XG5cbi8qKlxuICogVHJ5IHRvIHJldHJpZXZlIGEgV2ViR0xSZW5kZXJpbmdDb250ZXh0IGZyb20gZWl0aGVyIGEgY2FudmFzIERPTUVsZW1lbnQgb3IgYW4gT2Zmc2NyZWVuQ2FudmFzXG4gKiBAcGFyYW0ge2ludH0gd2lkdGhcbiAqIEBwYXJhbSB7aW50fSBoZWlnaHRcbiAqIEBwYXJhbSB7b2JqZWN0fSBnbE9wdGlvbnNcbiAqIEByZXR1cm5zIHt7Y2FudmFzOiAqLCBnbDogV2ViR0xSZW5kZXJpbmdDb250ZXh0LCByZXNpemU6IEZ1bmN0aW9ufX0gT2JqZWN0IHdpdGggY2FudmFzLCBnbCBjb250ZXh0IGFuZCBzdGFuZGFyZGl6ZWQgcmVzaXplIGZ1bmN0aW9uLlxuICovXG52YXIgZ2V0V2ViR2xDb250ZXh0ID0gZnVuY3Rpb24gZ2V0V2ViR2xDb250ZXh0ICh3aWR0aCwgaGVpZ2h0LCBnbE9wdGlvbnMpIHtcbiAgICB2YXIgY2FudmFzLFxuICAgICAgICBjb250ZXh0O1xuXG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKGlzV2ViKSB7XG4gICAgICAgICAgICBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgICAgICAgIGNhbnZhcy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgICAgY2FudmFzLmhlaWdodCA9IGhlaWdodDtcbiAgICAgICAgfSBlbHNlIGlmKGhhc09mZnNjcmVlbkNhbnZhcykge1xuICAgICAgICAgICAgY2FudmFzID0gbmV3IE9mZnNjcmVlbkNhbnZhcyh3aWR0aCwgaGVpZ2h0KTsgLy9taWdodCBjcmFzaCBpbiBGaXJlZm94IDw9IDQ1Lnggb24gTWFjIE9TIFhcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRleHQgPSBjYW52YXMuZ2V0Q29udGV4dCgnd2ViZ2wyJywgZ2xPcHRpb25zKSB8fCBjYW52YXMuZ2V0Q29udGV4dCgnd2ViZ2wnLCBnbE9wdGlvbnMpIHx8IGNhbnZhcy5nZXRDb250ZXh0KCdleHBlcmltZW50YWwtd2ViZ2wnLCBnbE9wdGlvbnMpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgaW5pdGlhbGl6ZSBXZWJHTFJlbmRlcmluZ0NvbnRleHQgOiAnICsgZS5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbnRleHQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgaW5pdGlhbGl6ZSBXZWJHTFJlbmRlcmluZ0NvbnRleHQgOiBub3Qgc3VwcG9ydGVkJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgY2FudmFzOiBjYW52YXMsXG4gICAgICAgIGdsOiBjb250ZXh0LFxuICAgICAgICByZXNpemU6IGZ1bmN0aW9uICh3aWR0aCwgaGVpZ2h0KSB7XG4gICAgICAgICAgICB0aGlzLmNhbnZhcy53aWR0aCA9IHdpZHRoO1xuICAgICAgICAgICAgdGhpcy5jYW52YXMuaGVpZ2h0ID0gaGVpZ2h0O1xuICAgICAgICB9XG4gICAgfTtcbn07XG5cbi8qKlxuICogUmV0cmlldmUgYW4gT3BlbkdMIGNvbnRleHRcbiAqIEBwYXJhbSB7aW50fSBbd2lkdGg9NjRdXG4gKiBAcGFyYW0ge2ludH0gW2hlaWdodD02NF1cbiAqIEBwYXJhbSB7b2JqZWN0fSBnbE9wdGlvbnNcbiAqIEByZXR1cm5zIHt7Y2FudmFzOiAqLCBnbDogV2ViR0xSZW5kZXJpbmdDb250ZXh0LCByZXNpemU6IEZ1bmN0aW9ufX0gT2JqZWN0IHdpdGggY2FudmFzLCBnbCBjb250ZXh0IGFuZCBzdGFuZGFyZGl6ZWQgcmVzaXplIGZ1bmN0aW9uLlxuICovXG52YXIgZ2V0Q29udGV4dCA9IGZ1bmN0aW9uIGdldENvbnRleHQgKHdpZHRoLCBoZWlnaHQsIGdsT3B0aW9ucykge1xuICAgIHdpZHRoID0gd2lkdGggfHwgNjQ7XG4gICAgaGVpZ2h0ID0gaGVpZ2h0IHx8IDY0O1xuXG4gICAgaWYgKGlzTm9kZSkge1xuICAgICAgICByZXR1cm4gZ2V0SGVhZGxlc3NHbENvbnRleHQod2lkdGgsIGhlaWdodCwgZ2xPcHRpb25zKTtcbiAgICB9IGVsc2UgaWYoaXNXZWIgfHwgaXNXb3JrZXIpIHtcbiAgICAgICAgcmV0dXJuIGdldFdlYkdsQ29udGV4dCh3aWR0aCwgaGVpZ2h0LCBnbE9wdGlvbnMpO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0Q29udGV4dDtcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoJ19wcm9jZXNzJykpIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBuZGFycmF5ID0gcmVxdWlyZSgnbmRhcnJheScpO1xuXG52YXIgdXRpbHMgPSB7fTtcblxudXRpbHMuY3JlYXRlQXJyYXkgPSBmdW5jdGlvbiAoc2hhcGUsIGRlZmF1bHRWYWx1ZSkge1xuICAgIHZhciBsZW5ndGggPSBzaGFwZS5yZWR1Y2UoZnVuY3Rpb24gKHAsIHYpIHsgcmV0dXJuIHAgKiB2OyB9LCAxKSxcbiAgICAgICAgZGF0YUFycmF5ID0gbmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSxcbiAgICAgICAgaTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICBkYXRhQXJyYXlbaV0gPSBkZWZhdWx0VmFsdWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5kYXJyYXkoZGF0YUFycmF5LCBzaGFwZSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHV0aWxzO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eUihbMS05XVswLTldKilcXC9UKFswLTldKylcXC9DKFsxLTldWzAtOV0qKVxcLyhOTXxOTikoXFwvR0h8KSQvaTtcblxuLy9hY3R1YWxseSBub3QgdGhlIHNhbWUgYXMgaW4gbGlmZSBhbmQgZ2VuZXJhdGlvbnNcbnZhciBnZXROZWlnaGJvdXJNZXRob2QgPSBmdW5jdGlvbiAobWV0aG9kSWQpIHtcbiAgICBpZiAobWV0aG9kSWQgPT09ICdOTicgfHwgbWV0aG9kSWQgPT09ICdubicgfHwgbWV0aG9kSWQgPT09ICd2b24tbmV1bWFubicpIHtcbiAgICAgICAgcmV0dXJuICd2b24tbmV1bWFubic7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuICdtb29yZSc7XG4gICAgfVxufTtcblxudmFyIHBhcnNlUnVsZVN0cmluZyA9IGZ1bmN0aW9uIChydWxlU3RyaW5nKSB7XG4gICAgdmFyIGV4dHJhY3RlZFJ1bGUgPSBydWxlUmVnZXhwLmV4ZWModXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyhydWxlU3RyaW5nKSk7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSA/IHtcbiAgICAgICAgcnVsZUZvcm1hdDogJ2N5Y2xpYycsXG4gICAgICAgIHJ1bGVTdHJpbmc6IHJ1bGVTdHJpbmcsXG4gICAgICAgIHRocmVzaG9sZDogcGFyc2VJbnQoZXh0cmFjdGVkUnVsZVsyXSwgMTApLFxuICAgICAgICBzdGF0ZUNvdW50OiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzNdLCAxMCksXG4gICAgICAgIGdyZWVuYmVyZ0hhc3RpbmdzTW9kZWw6ICghIWV4dHJhY3RlZFJ1bGVbNV0pLFxuICAgICAgICBuZWlnaGJvdXJob29kVHlwZTogZ2V0TmVpZ2hib3VyTWV0aG9kKGV4dHJhY3RlZFJ1bGVbNF0pLFxuICAgICAgICBuZWlnaGJvdXJob29kUmFuZ2U6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbMV0sIDEwKSB8fCAxXG4gICAgfSA6IG51bGw7XG59O1xuXG52YXIgY3ljbGljRnVuY3Rpb24gPSBmdW5jdGlvbiAoY3VycmVudFZhbHVlLCBuZWlnaGJvdXJzKSB7XG4gICAgdmFyIG5leHRWYWx1ZSA9IChjdXJyZW50VmFsdWUgKyAxKSAlIHRoaXMuc3RhdGVDb3VudCxcbiAgICAgICAgaW5kZXggPSAwLFxuICAgICAgICBzdW0gPSAwLFxuICAgICAgICBuZWlnaGJvdXJzTGVuZ3RoID0gbmVpZ2hib3Vycy5sZW5ndGgsXG4gICAgICAgIHJlc3VsdDtcblxuICAgIGZvciAoOyBpbmRleCA8IG5laWdoYm91cnNMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgc3VtID0gc3VtICsgKG5laWdoYm91cnNbaW5kZXhdID09PSBuZXh0VmFsdWUgPyAxIDogMCk7XG4gICAgfVxuXG4gICAgaWYgKHN1bSA+PSB0aGlzLnRocmVzaG9sZCB8fCAodGhpcy5ncmVlbmJlcmdIYXN0aW5nc01vZGVsICYmIGN1cnJlbnRWYWx1ZSAhPT0gMCkpIHtcbiAgICAgICAgcmVzdWx0ID0gbmV4dFZhbHVlO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IGN1cnJlbnRWYWx1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxudmFyIGN5Y2xpYyA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgdmFyIHJ1bGVEZXNjcmlwdGlvbiA9IHBhcnNlUnVsZVN0cmluZyhydWxlKTtcblxuICAgIGlmIChydWxlRGVzY3JpcHRpb24gIT09IG51bGwpIHtcbiAgICAgICAgcnVsZURlc2NyaXB0aW9uLnByb2Nlc3MgPSBjeWNsaWNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVsZURlc2NyaXB0aW9uO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBjeWNsaWM7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMvdXRpbHMnKSxcbiAgICBydWxlUmVnZXhwID0gL15FUz8oWzAtOSwuXSopXFwvQj8oWzAtOSwuXSopXFwvQz8oWzEtOV1bMC05XSopKE18Vnx2b24tbmV1bWFubnxtb29yZXxheGlzfGNvcm5lcnxlZGdlfGZhY2V8KShbMC05XSopJC9pO1xuXG52YXIgZ2V0TmVpZ2hib3VyTWV0aG9kID0gZnVuY3Rpb24gKG1ldGhvZElkKSB7XG4gICAgbWV0aG9kSWQgPSBtZXRob2RJZC50b0xvd2VyQ2FzZSgpO1xuXG4gICAgaWYgKG1ldGhvZElkID09PSAndicpIHtcbiAgICAgICAgcmV0dXJuICd2b24tbmV1bWFubic7XG4gICAgfSBlbHNlIGlmIChtZXRob2RJZCA9PT0gJ20nIHx8IG1ldGhvZElkID09PSAnJyl7XG4gICAgICAgIHJldHVybiAnbW9vcmUnO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBtZXRob2RJZDtcbiAgICB9XG59O1xuXG52YXIgcGFyc2VSdWxlU3RyaW5nID0gZnVuY3Rpb24gKHJ1bGVTdHJpbmcpIHtcbiAgICB2YXIgZXh0cmFjdGVkUnVsZSA9IHJ1bGVSZWdleHAuZXhlYyh1dGlscy5zdHJpcFdoaXRlc3BhY2VzKHJ1bGVTdHJpbmcpKTtcblxuICAgIHJldHVybiBleHRyYWN0ZWRSdWxlID8ge1xuICAgICAgICBydWxlRm9ybWF0OiAnZXh0ZW5kZWQtZ2VuZXJhdGlvbnMnLFxuICAgICAgICBydWxlU3RyaW5nOiBydWxlU3RyaW5nLFxuICAgICAgICBzdXJ2aXZhbDogdXRpbHMuc3BsaXRDb21tYVNlcGFyYXRlZE51bWJlcnNXaXRoUmFuZ2VzKGV4dHJhY3RlZFJ1bGVbMV0pLFxuICAgICAgICBiaXJ0aDogdXRpbHMuc3BsaXRDb21tYVNlcGFyYXRlZE51bWJlcnNXaXRoUmFuZ2VzKGV4dHJhY3RlZFJ1bGVbMl0pLFxuICAgICAgICBzdGF0ZUNvdW50OiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzNdLCAxMCkgfHwgMSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFR5cGU6IGdldE5laWdoYm91ck1ldGhvZChleHRyYWN0ZWRSdWxlWzRdKSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFJhbmdlOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzVdLCAxMCkgfHwgMVxuICAgIH0gOiBudWxsO1xufTtcblxudmFyIGV4dGVuZGVkR2VuZXJhdGlvbnNGdW5jdGlvbiA9IGZ1bmN0aW9uIChjdXJyZW50VmFsdWUsIG5laWdoYm91cnMpIHtcbiAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICBzdW0gPSAwLFxuICAgICAgICBuZWlnaGJvdXJzTGVuZ3RoID0gbmVpZ2hib3Vycy5sZW5ndGgsXG4gICAgICAgIHJlc3VsdDtcblxuICAgIGZvciAoOyBpbmRleCA8IG5laWdoYm91cnNMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgc3VtID0gc3VtICsgKG5laWdoYm91cnNbaW5kZXhdID09PSAxID8gMSA6IDApO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50VmFsdWUgPT09IDAgJiYgdGhpcy5iaXJ0aC5pbmRleE9mKHN1bSkgPiAtMSkge1xuICAgICAgICByZXN1bHQgPSAxO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudFZhbHVlID09PSAxICYmIHRoaXMuc3Vydml2YWwuaW5kZXhPZihzdW0pID4gLTEpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+IDApIHtcbiAgICAgICAgcmVzdWx0ID0gKGN1cnJlbnRWYWx1ZSArIDEpICUgdGhpcy5zdGF0ZUNvdW50O1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbnZhciBleHRlbmRlZEdlbmVyYXRpb25zID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICB2YXIgcnVsZURlc2NyaXB0aW9uID0gcGFyc2VSdWxlU3RyaW5nKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGVEZXNjcmlwdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBydWxlRGVzY3JpcHRpb24ucHJvY2VzcyA9IGV4dGVuZGVkR2VuZXJhdGlvbnNGdW5jdGlvbjtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVsZURlc2NyaXB0aW9uO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBleHRlbmRlZEdlbmVyYXRpb25zO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eRVM/KFswLTksLl0qKVxcL0I/KFswLTksLl0qKShNfFZ8dm9uLW5ldW1hbm58bW9vcmV8YXhpc3xjb3JuZXJ8ZWRnZXxmYWNlfCkoWzAtOV0qKSQvaTtcblxudmFyIGdldE5laWdoYm91ck1ldGhvZCA9IGZ1bmN0aW9uIChtZXRob2RJZCkge1xuICAgIG1ldGhvZElkID0gbWV0aG9kSWQudG9Mb3dlckNhc2UoKTtcblxuICAgIGlmIChtZXRob2RJZCA9PT0gJ3YnKSB7XG4gICAgICAgIHJldHVybiAndm9uLW5ldW1hbm4nO1xuICAgIH0gZWxzZSBpZiAobWV0aG9kSWQgPT09ICdtJyB8fCBtZXRob2RJZCA9PT0gJycpe1xuICAgICAgICByZXR1cm4gJ21vb3JlJztcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gbWV0aG9kSWQ7XG4gICAgfVxufTtcblxudmFyIHBhcnNlUnVsZVN0cmluZyA9IGZ1bmN0aW9uIChydWxlU3RyaW5nKSB7XG4gICAgdmFyIGV4dHJhY3RlZFJ1bGUgPSBydWxlUmVnZXhwLmV4ZWModXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyhydWxlU3RyaW5nKSk7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSA/IHtcbiAgICAgICAgcnVsZUZvcm1hdDogJ2V4dGVuZGVkLWxpZmUnLFxuICAgICAgICBydWxlU3RyaW5nOiBydWxlU3RyaW5nLFxuICAgICAgICBzdXJ2aXZhbDogdXRpbHMuc3BsaXRDb21tYVNlcGFyYXRlZE51bWJlcnNXaXRoUmFuZ2VzKGV4dHJhY3RlZFJ1bGVbMV0pLFxuICAgICAgICBiaXJ0aDogdXRpbHMuc3BsaXRDb21tYVNlcGFyYXRlZE51bWJlcnNXaXRoUmFuZ2VzKGV4dHJhY3RlZFJ1bGVbMl0pLFxuICAgICAgICBuZWlnaGJvdXJob29kVHlwZTogZ2V0TmVpZ2hib3VyTWV0aG9kKGV4dHJhY3RlZFJ1bGVbM10pLFxuICAgICAgICBuZWlnaGJvdXJob29kUmFuZ2U6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbNF0sIDEwKSB8fCAxXG4gICAgfSA6IG51bGw7XG59O1xuXG52YXIgZXh0ZW5kZWRMaWZlRnVuY3Rpb24gPSBmdW5jdGlvbiAoY3VycmVudFZhbHVlLCBuZWlnaGJvdXJzKSB7XG4gICAgdmFyIGluZGV4ID0gMCxcbiAgICAgICAgc3VtID0gMCxcbiAgICAgICAgbmVpZ2hib3Vyc0xlbmd0aCA9IG5laWdoYm91cnMubGVuZ3RoLFxuICAgICAgICByZXN1bHQ7XG5cbiAgICBmb3IgKDsgaW5kZXggPCBuZWlnaGJvdXJzTGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgIHN1bSA9IHN1bSArIG5laWdoYm91cnNbaW5kZXhdO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50VmFsdWUgPT09IDAgJiYgdGhpcy5iaXJ0aC5pbmRleE9mKHN1bSkgPiAtMSkge1xuICAgICAgICByZXN1bHQgPSAxO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudFZhbHVlID09PSAxICYmIHRoaXMuc3Vydml2YWwuaW5kZXhPZihzdW0pID4gLTEpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHQgPSAwO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG52YXIgZXh0ZW5kZWRMaWZlID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICB2YXIgcnVsZURlc2NyaXB0aW9uID0gcGFyc2VSdWxlU3RyaW5nKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGVEZXNjcmlwdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBydWxlRGVzY3JpcHRpb24ucHJvY2VzcyA9IGV4dGVuZGVkTGlmZUZ1bmN0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBydWxlRGVzY3JpcHRpb247XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZGVkTGlmZTtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscy91dGlscycpLFxuICAgIHJ1bGVSZWdleHAgPSAvXkVTPyhbMC05LC46XSopXFwvQj8oWzAtOSwuOl0qKShNfFZ8dm9uLW5ldW1hbm58bW9vcmV8YXhpc3xjb3JuZXJ8ZWRnZXxmYWNlfCkoWzAtOV0qKSQvaTtcblxudmFyIGdldE5laWdoYm91ck1ldGhvZCA9IGZ1bmN0aW9uIChtZXRob2RJZCkge1xuICAgIG1ldGhvZElkID0gbWV0aG9kSWQudG9Mb3dlckNhc2UoKTtcblxuICAgIGlmIChtZXRob2RJZCA9PT0gJ3YnKSB7XG4gICAgICAgIHJldHVybiAndm9uLW5ldW1hbm4nO1xuICAgIH0gZWxzZSBpZiAobWV0aG9kSWQgPT09ICdtJyB8fCBtZXRob2RJZCA9PT0gJycpe1xuICAgICAgICByZXR1cm4gJ21vb3JlJztcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gbWV0aG9kSWQ7XG4gICAgfVxufTtcblxudmFyIHJlZ2V4UmFuZ2UgPSAvKFswLTldKylcXC5cXC4oWzAtOV0rKS8sXG4gICAgcmVnZXhQcm9iYWJpbGl0eSA9IC8oWzAtOS5dKyk6KFswLTkuXSspLztcblxudmFyIHBhcnNlU3RvY2hhc3RpY0FyZ3MgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gICAgLy9UT0RPIHJlZmFjdG9yIHRvIHV0aWxzIGFsb25nIHdpdGggc3BsaXRDb21tYVNlcGFyYXRlZE51bWJlcnNXaXRoUmFuZ2VzXG5cbiAgICB2YXIgc3BsaXRTdHJpbmcgPSBzdHJpbmcuc3BsaXQoJywnKSxcbiAgICAgICAgcmVzdWx0ID0ge30sXG4gICAgICAgIGV4cHJlc3Npb24sXG4gICAgICAgIHJhbmdlTWF0Y2gsXG4gICAgICAgIHByb2JhYmlsaXR5TWF0Y2gsXG4gICAgICAgIHByb2JhYmlsaXR5LFxuICAgICAgICBpID0gMDtcblxuICAgIGZvciAoOyBpIDwgc3BsaXRTdHJpbmcubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXhwcmVzc2lvbiA9IHNwbGl0U3RyaW5nW2ldO1xuICAgICAgICByYW5nZU1hdGNoID0gcmVnZXhSYW5nZS5leGVjKGV4cHJlc3Npb24pO1xuICAgICAgICBwcm9iYWJpbGl0eU1hdGNoID0gcmVnZXhQcm9iYWJpbGl0eS5leGVjKGV4cHJlc3Npb24pO1xuXG4gICAgICAgIHByb2JhYmlsaXR5ID0gcHJvYmFiaWxpdHlNYXRjaCA/IHBhcnNlRmxvYXQocHJvYmFiaWxpdHlNYXRjaFsyXSkgOiAxO1xuICAgICAgICBwcm9iYWJpbGl0eSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHByb2JhYmlsaXR5KSk7XG5cbiAgICAgICAgaWYgKHByb2JhYmlsaXR5ID4gMCB8fCBpc05hTihwcm9iYWJpbGl0eSkpIHtcbiAgICAgICAgICAgIGlmIChyYW5nZU1hdGNoKSB7XG4gICAgICAgICAgICAgICAgdXRpbHMuYXBwZW5kUmFuZ2VUb09iamVjdFdpdGhQcm9iYWJpbGl0eShwYXJzZUludChyYW5nZU1hdGNoWzFdLCAxMCksIHBhcnNlSW50KHJhbmdlTWF0Y2hbMl0sIDEwKSwgcHJvYmFiaWxpdHksIHJlc3VsdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlc3VsdFtwYXJzZUludChleHByZXNzaW9uLCAxMCldID0gcHJvYmFiaWxpdHk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxudmFyIHBhcnNlUnVsZVN0cmluZyA9IGZ1bmN0aW9uIChydWxlU3RyaW5nKSB7XG4gICAgdmFyIGV4dHJhY3RlZFJ1bGUgPSBydWxlUmVnZXhwLmV4ZWModXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyhydWxlU3RyaW5nKSk7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSA/IHtcbiAgICAgICAgcnVsZUZvcm1hdDogJ2V4dGVuZGVkLXN0b2NoYXN0aWMnLFxuICAgICAgICBydWxlU3RyaW5nOiBydWxlU3RyaW5nLFxuICAgICAgICBzdXJ2aXZhbDogcGFyc2VTdG9jaGFzdGljQXJncyhleHRyYWN0ZWRSdWxlWzFdKSwgLy91dGlscy5zcGxpdENvbW1hU2VwYXJhdGVkTnVtYmVyc1dpdGhSYW5nZXMoZXh0cmFjdGVkUnVsZVsxXSksXG4gICAgICAgIGJpcnRoOiBwYXJzZVN0b2NoYXN0aWNBcmdzKGV4dHJhY3RlZFJ1bGVbMl0pLCAvL3V0aWxzLnNwbGl0Q29tbWFTZXBhcmF0ZWROdW1iZXJzV2l0aFJhbmdlcyhleHRyYWN0ZWRSdWxlWzJdKSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFR5cGU6IGdldE5laWdoYm91ck1ldGhvZChleHRyYWN0ZWRSdWxlWzNdKSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFJhbmdlOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzRdLCAxMCkgfHwgMVxuICAgIH0gOiBudWxsO1xufTtcblxudmFyIGV4dGVuZGVkU3RvY2hhc3RpY0Z1bmN0aW9uID0gZnVuY3Rpb24gKGN1cnJlbnRWYWx1ZSwgbmVpZ2hib3Vycywgcm5nKSB7XG4gICAgdmFyIGluZGV4ID0gMCxcbiAgICAgICAgc3VtID0gMCxcbiAgICAgICAgbmVpZ2hib3Vyc0xlbmd0aCA9IG5laWdoYm91cnMubGVuZ3RoLFxuICAgICAgICByZXN1bHQ7XG5cbiAgICBybmcgPSBybmcgfHwgTWF0aC5yYW5kb207XG5cbiAgICBmb3IgKDsgaW5kZXggPCBuZWlnaGJvdXJzTGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgICAgIHN1bSA9IHN1bSArIG5laWdoYm91cnNbaW5kZXhdO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50VmFsdWUgPT09IDAgJiYgISF0aGlzLmJpcnRoW3N1bV0pIHtcbiAgICAgICAgcmVzdWx0ID0gKHRoaXMuYmlydGhbc3VtXSA9PT0gMSB8fCB0aGlzLmJpcnRoW3N1bV0gPiBybmcoKSkgPyAxIDogMDtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMSAmJiAhIXRoaXMuc3Vydml2YWxbc3VtXSkge1xuICAgICAgICByZXN1bHQgPSAodGhpcy5zdXJ2aXZhbFtzdW1dID09PSAxIHx8IHRoaXMuc3Vydml2YWxbc3VtXSA+IHJuZygpKSA/IDEgOiAwO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbnZhciBleHRlbmRlZFN0b2NoYXN0aWMgPSBmdW5jdGlvbiAocnVsZSkge1xuICAgIHZhciBydWxlRGVzY3JpcHRpb24gPSBwYXJzZVJ1bGVTdHJpbmcocnVsZSk7XG5cbiAgICBpZiAocnVsZURlc2NyaXB0aW9uICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bGVEZXNjcmlwdGlvbi5wcm9jZXNzID0gZXh0ZW5kZWRTdG9jaGFzdGljRnVuY3Rpb247XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bGVEZXNjcmlwdGlvbjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kZWRTdG9jaGFzdGljO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eUz8oWzAtOV0qKVxcL0I/KFswLTldKilcXC9DPyhbMS05XVswLTldKikoW01WXT8pKFswLTldKikkL2k7XG5cbnZhciBnZXROZWlnaGJvdXJNZXRob2QgPSBmdW5jdGlvbiAobWV0aG9kSWQpIHtcbiAgICBpZiAobWV0aG9kSWQgPT09ICdWJyB8fCBtZXRob2RJZCA9PT0gJ3YnIHx8IG1ldGhvZElkID09PSAndm9uLW5ldW1hbm4nKSB7XG4gICAgICAgIHJldHVybiAndm9uLW5ldW1hbm4nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiAnbW9vcmUnO1xuICAgIH1cbn07XG5cbnZhciBwYXJzZVJ1bGVTdHJpbmcgPSBmdW5jdGlvbiAocnVsZVN0cmluZykge1xuICAgIHZhciBleHRyYWN0ZWRSdWxlID0gcnVsZVJlZ2V4cC5leGVjKHV0aWxzLnN0cmlwV2hpdGVzcGFjZXMocnVsZVN0cmluZykpO1xuXG4gICAgcmV0dXJuIGV4dHJhY3RlZFJ1bGUgPyB7XG4gICAgICAgIHJ1bGVGb3JtYXQ6ICdnZW5lcmF0aW9ucycsXG4gICAgICAgIHJ1bGVTdHJpbmc6IHJ1bGVTdHJpbmcsXG4gICAgICAgIHN1cnZpdmFsOiB1dGlscy5zcGxpdFN0cmluZ0luTnVtYmVyQXJyYXkoZXh0cmFjdGVkUnVsZVsxXSksXG4gICAgICAgIGJpcnRoOiB1dGlscy5zcGxpdFN0cmluZ0luTnVtYmVyQXJyYXkoZXh0cmFjdGVkUnVsZVsyXSksXG4gICAgICAgIHN0YXRlQ291bnQ6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbM10sIDEwKSB8fCAxLFxuICAgICAgICBuZWlnaGJvdXJob29kVHlwZTogZ2V0TmVpZ2hib3VyTWV0aG9kKGV4dHJhY3RlZFJ1bGVbNF0pLFxuICAgICAgICBuZWlnaGJvdXJob29kUmFuZ2U6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbNV0sIDEwKSB8fCAxXG4gICAgfSA6IG51bGw7XG59O1xuXG52YXIgZ2VuZXJhdGlvbnNGdW5jdGlvbiA9IGZ1bmN0aW9uIChjdXJyZW50VmFsdWUsIG5laWdoYm91cnMpIHtcbiAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICBzdW0gPSAwLFxuICAgICAgICBuZWlnaGJvdXJzTGVuZ3RoID0gbmVpZ2hib3Vycy5sZW5ndGgsXG4gICAgICAgIHJlc3VsdDtcblxuICAgIGZvciAoOyBpbmRleCA8IG5laWdoYm91cnNMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgc3VtID0gc3VtICsgKG5laWdoYm91cnNbaW5kZXhdID09PSAxID8gMSA6IDApO1xuICAgIH1cblxuICAgIGlmIChjdXJyZW50VmFsdWUgPT09IDAgJiYgdGhpcy5iaXJ0aC5pbmRleE9mKHN1bSkgPiAtMSkge1xuICAgICAgICByZXN1bHQgPSAxO1xuICAgIH0gZWxzZSBpZiAoY3VycmVudFZhbHVlID09PSAxICYmIHRoaXMuc3Vydml2YWwuaW5kZXhPZihzdW0pID4gLTEpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+IDApIHtcbiAgICAgICAgcmVzdWx0ID0gKGN1cnJlbnRWYWx1ZSArIDEpICUgdGhpcy5zdGF0ZUNvdW50O1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbnZhciBnZW5lcmF0aW9ucyA9IGZ1bmN0aW9uIChydWxlKSB7XG4gICAgdmFyIHJ1bGVEZXNjcmlwdGlvbiA9IHBhcnNlUnVsZVN0cmluZyhydWxlKTtcblxuICAgIGlmIChydWxlRGVzY3JpcHRpb24gIT09IG51bGwpIHtcbiAgICAgICAgcnVsZURlc2NyaXB0aW9uLnByb2Nlc3MgPSBnZW5lcmF0aW9uc0Z1bmN0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBydWxlRGVzY3JpcHRpb247XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdlbmVyYXRpb25zO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eUz8oWzAtOV0qKVxcL0I/KFswLTldKikoW01WXT8pKFswLTldKikkL2k7XG5cbnZhciBnZXROZWlnaGJvdXJNZXRob2QgPSBmdW5jdGlvbiAobWV0aG9kSWQpIHtcbiAgICBpZiAobWV0aG9kSWQgPT09ICdWJyB8fCBtZXRob2RJZCA9PT0gJ3YnIHx8IG1ldGhvZElkID09PSAndm9uLW5ldW1hbm4nKSB7XG4gICAgICAgIHJldHVybiAndm9uLW5ldW1hbm4nO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiAnbW9vcmUnO1xuICAgIH1cbn07XG5cbnZhciBwYXJzZVJ1bGVTdHJpbmcgPSBmdW5jdGlvbiAocnVsZVN0cmluZykge1xuICAgIHZhciBleHRyYWN0ZWRSdWxlID0gcnVsZVJlZ2V4cC5leGVjKHV0aWxzLnN0cmlwV2hpdGVzcGFjZXMocnVsZVN0cmluZykpO1xuXG4gICAgcmV0dXJuIGV4dHJhY3RlZFJ1bGUgPyB7XG4gICAgICAgIHJ1bGVGb3JtYXQ6ICdsaWZlJyxcbiAgICAgICAgcnVsZVN0cmluZzogcnVsZVN0cmluZyxcbiAgICAgICAgc3Vydml2YWw6IHV0aWxzLnNwbGl0U3RyaW5nSW5OdW1iZXJBcnJheShleHRyYWN0ZWRSdWxlWzFdKSxcbiAgICAgICAgYmlydGg6IHV0aWxzLnNwbGl0U3RyaW5nSW5OdW1iZXJBcnJheShleHRyYWN0ZWRSdWxlWzJdKSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFR5cGU6IGdldE5laWdoYm91ck1ldGhvZChleHRyYWN0ZWRSdWxlWzNdKSxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFJhbmdlOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzRdLCAxMCkgfHwgMVxuICAgIH0gOiBudWxsO1xufTtcblxudmFyIGxpZmVGdW5jdGlvbiA9IGZ1bmN0aW9uIChjdXJyZW50VmFsdWUsIG5laWdoYm91cnMpIHtcbiAgICB2YXIgaW5kZXggPSAwLFxuICAgICAgICBzdW0gPSAwLFxuICAgICAgICBuZWlnaGJvdXJzTGVuZ3RoID0gbmVpZ2hib3Vycy5sZW5ndGgsXG4gICAgICAgIHJlc3VsdDtcblxuICAgIGZvciAoOyBpbmRleCA8IG5laWdoYm91cnNMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgc3VtID0gc3VtICsgbmVpZ2hib3Vyc1tpbmRleF07XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMCAmJiB0aGlzLmJpcnRoLmluZGV4T2Yoc3VtKSA+IC0xKSB7XG4gICAgICAgIHJlc3VsdCA9IDE7XG4gICAgfSBlbHNlIGlmIChjdXJyZW50VmFsdWUgPT09IDEgJiYgdGhpcy5zdXJ2aXZhbC5pbmRleE9mKHN1bSkgPiAtMSkge1xuICAgICAgICByZXN1bHQgPSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbnZhciBsaWZlID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICB2YXIgcnVsZURlc2NyaXB0aW9uID0gcGFyc2VSdWxlU3RyaW5nKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGVEZXNjcmlwdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBydWxlRGVzY3JpcHRpb24ucHJvY2VzcyA9IGxpZmVGdW5jdGlvbjtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVsZURlc2NyaXB0aW9uO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBsaWZlO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eTFVLWShbMC05XSkoWzAtOV0pKFswLTldKShbMC05XSkkL2k7XG5cbnZhciBwYXJzZVJ1bGVTdHJpbmcgPSBmdW5jdGlvbiAocnVsZVN0cmluZykge1xuICAgIHZhciBleHRyYWN0ZWRSdWxlID0gcnVsZVJlZ2V4cC5leGVjKHV0aWxzLnN0cmlwV2hpdGVzcGFjZXMocnVsZVN0cmluZykpO1xuXG4gICAgcmV0dXJuIGV4dHJhY3RlZFJ1bGUgPyB7XG4gICAgICAgIHJ1bGVGb3JtYXQ6ICdsdWt5JyxcbiAgICAgICAgcnVsZVN0cmluZzogcnVsZVN0cmluZyxcbiAgICAgICAgbG93QmlydGg6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbMV0sIDEwKSxcbiAgICAgICAgaGlnaEJpcnRoOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzJdLCAxMCksXG4gICAgICAgIGxvd1N1cnZpdmFsOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzNdLCAxMCksXG4gICAgICAgIGhpZ2hTdXJ2aXZhbDogcGFyc2VJbnQoZXh0cmFjdGVkUnVsZVs0XSwgMTApLFxuICAgICAgICBuZWlnaGJvdXJob29kVHlwZTogJ21vb3JlJyxcbiAgICAgICAgbmVpZ2hib3VyaG9vZFJhbmdlOiAxXG4gICAgfSA6IG51bGw7XG59O1xuXG52YXIgbHVreUZ1bmN0aW9uID0gZnVuY3Rpb24gKGN1cnJlbnRWYWx1ZSwgbmVpZ2hib3Vycykge1xuICAgIHZhciBpbmRleCA9IDAsXG4gICAgICAgIHN1bSA9IDAsXG4gICAgICAgIG5laWdoYm91cnNMZW5ndGggPSBuZWlnaGJvdXJzLmxlbmd0aCxcbiAgICAgICAgcmVzdWx0O1xuXG4gICAgZm9yICg7IGluZGV4IDwgbmVpZ2hib3Vyc0xlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICBzdW0gPSBzdW0gKyAobmVpZ2hib3Vyc1tpbmRleF0gPT09IDEgPyAxIDogMCk7XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMCAmJiBzdW0gPj0gdGhpcy5sb3dCaXJ0aCAmJiBzdW0gPD0gdGhpcy5oaWdoQmlydGgpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMSAmJiBzdW0gPj0gdGhpcy5sb3dTdXJ2aXZhbCAmJiBzdW0gPD0gdGhpcy5oaWdoU3Vydml2YWwpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgICByZXN1bHQgPSAwO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG52YXIgZ2VuZXJhdGlvbnMgPSBmdW5jdGlvbiAocnVsZSkge1xuICAgIHZhciBydWxlRGVzY3JpcHRpb24gPSBwYXJzZVJ1bGVTdHJpbmcocnVsZSk7XG5cbiAgICBpZiAocnVsZURlc2NyaXB0aW9uICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bGVEZXNjcmlwdGlvbi5wcm9jZXNzID0gbHVreUZ1bmN0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBydWxlRGVzY3JpcHRpb247XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGdlbmVyYXRpb25zO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eTkxVS1koWzAtOV0pKFswLTldKShbMC05XSkoWzAtOV0pKFswLTldKSQvaTtcblxudmFyIHBhcnNlUnVsZVN0cmluZyA9IGZ1bmN0aW9uIChydWxlU3RyaW5nKSB7XG4gICAgdmFyIGV4dHJhY3RlZFJ1bGUgPSBydWxlUmVnZXhwLmV4ZWModXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyhydWxlU3RyaW5nKSk7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSA/IHtcbiAgICAgICAgcnVsZUZvcm1hdDogJ25sdWt5JyxcbiAgICAgICAgcnVsZVN0cmluZzogcnVsZVN0cmluZyxcbiAgICAgICAgc3RhdGVDb3VudDogcGFyc2VJbnQoZXh0cmFjdGVkUnVsZVsxXSwgMTApLFxuICAgICAgICBsb3dCaXJ0aDogcGFyc2VJbnQoZXh0cmFjdGVkUnVsZVsyXSwgMTApLFxuICAgICAgICBoaWdoQmlydGg6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbM10sIDEwKSxcbiAgICAgICAgbG93U3Vydml2YWw6IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbNF0sIDEwKSxcbiAgICAgICAgaGlnaFN1cnZpdmFsOiBwYXJzZUludChleHRyYWN0ZWRSdWxlWzVdLCAxMCksXG4gICAgICAgIG5laWdoYm91cmhvb2RUeXBlOiAnbW9vcmUnLFxuICAgICAgICBuZWlnaGJvdXJob29kUmFuZ2U6IDFcbiAgICB9IDogbnVsbDtcbn07XG5cbnZhciBubHVreUZ1bmN0aW9uID0gZnVuY3Rpb24gKGN1cnJlbnRWYWx1ZSwgbmVpZ2hib3Vycykge1xuICAgIHZhciBpbmRleCA9IDAsXG4gICAgICAgIHN1bSA9IDAsXG4gICAgICAgIG5laWdoYm91cnNMZW5ndGggPSBuZWlnaGJvdXJzLmxlbmd0aCxcbiAgICAgICAgcmVzdWx0O1xuXG4gICAgZm9yICg7IGluZGV4IDwgbmVpZ2hib3Vyc0xlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICBzdW0gPSBzdW0gKyAobmVpZ2hib3Vyc1tpbmRleF0gPT09IDEgPyAxIDogMCk7XG4gICAgfVxuXG4gICAgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMCAmJiBzdW0gPj0gdGhpcy5sb3dCaXJ0aCAmJiBzdW0gPD0gdGhpcy5oaWdoQmlydGgpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMSAmJiBzdW0gPj0gdGhpcy5sb3dTdXJ2aXZhbCAmJiBzdW0gPD0gdGhpcy5oaWdoU3Vydml2YWwpIHtcbiAgICAgICAgcmVzdWx0ID0gMTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gMSkge1xuICAgICAgICByZXN1bHQgPSAyICUgKDIgKyB0aGlzLnN0YXRlQ291bnQgKiAyKTtcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRWYWx1ZSA+PSAyKSB7XG4gICAgICAgIHJlc3VsdCA9IChjdXJyZW50VmFsdWUgKyAyKSAlICgyICsgdGhpcy5zdGF0ZUNvdW50ICogMik7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0ID0gMDtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xufTtcblxudmFyIGdlbmVyYXRpb25zID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICB2YXIgcnVsZURlc2NyaXB0aW9uID0gcGFyc2VSdWxlU3RyaW5nKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGVEZXNjcmlwdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBydWxlRGVzY3JpcHRpb24ucHJvY2VzcyA9IG5sdWt5RnVuY3Rpb247XG4gICAgfVxuXG4gICAgcmV0dXJuIHJ1bGVEZXNjcmlwdGlvbjtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZ2VuZXJhdGlvbnM7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMvdXRpbHMnKSxcbiAgICBydWxlUmVnZXhwID0gL14oWzAtOV0rKShbTVZdPykoWzAtOV0qKSQvaTtcblxudmFyIGdldE5laWdoYm91ck1ldGhvZCA9IGZ1bmN0aW9uIChtZXRob2RJZCkge1xuICAgIGlmIChtZXRob2RJZCA9PT0gJ1YnIHx8IG1ldGhvZElkID09PSAndicgfHwgbWV0aG9kSWQgPT09ICd2b24tbmV1bWFubicpIHtcbiAgICAgICAgcmV0dXJuICd2b24tbmV1bWFubic7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuICdtb29yZSc7XG4gICAgfVxufTtcblxudmFyIHBhcnNlUnVsZVN0cmluZyA9IGZ1bmN0aW9uIChydWxlU3RyaW5nKSB7XG4gICAgdmFyIGV4dHJhY3RlZFJ1bGUgPSBydWxlUmVnZXhwLmV4ZWModXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyhydWxlU3RyaW5nKSk7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSA/IHtcbiAgICAgICAgcnVsZUZvcm1hdDogJ3ZvdGUnLFxuICAgICAgICBydWxlU3RyaW5nOiBydWxlU3RyaW5nLFxuICAgICAgICB2b3RlOiB1dGlscy5zcGxpdFN0cmluZ0luTnVtYmVyQXJyYXkoZXh0cmFjdGVkUnVsZVsxXSksXG4gICAgICAgIG5laWdoYm91cmhvb2RUeXBlOiBnZXROZWlnaGJvdXJNZXRob2QoZXh0cmFjdGVkUnVsZVsyXSksXG4gICAgICAgIG5laWdoYm91cmhvb2RSYW5nZTogcGFyc2VJbnQoZXh0cmFjdGVkUnVsZVszXSwgMTApIHx8IDFcbiAgICB9IDogbnVsbDtcbn07XG5cbnZhciB2b3RlRnVuY3Rpb24gPSBmdW5jdGlvbiAoY3VycmVudFZhbHVlLCBuZWlnaGJvdXJzKSB7XG4gICAgdmFyIGluZGV4ID0gMCxcbiAgICAgICAgc3VtID0gY3VycmVudFZhbHVlLFxuICAgICAgICBuZWlnaGJvdXJzTGVuZ3RoID0gbmVpZ2hib3Vycy5sZW5ndGgsXG4gICAgICAgIHJlc3VsdDtcblxuICAgIGZvciAoOyBpbmRleCA8IG5laWdoYm91cnNMZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgc3VtID0gc3VtICsgbmVpZ2hib3Vyc1tpbmRleF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMudm90ZS5pbmRleE9mKHN1bSkgPiAtMSkge1xuICAgICAgICByZXN1bHQgPSAxO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc3VsdCA9IDA7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbn07XG5cbnZhciB2b3RlID0gZnVuY3Rpb24gKHJ1bGUpIHtcbiAgICB2YXIgcnVsZURlc2NyaXB0aW9uID0gcGFyc2VSdWxlU3RyaW5nKHJ1bGUpO1xuXG4gICAgaWYgKHJ1bGVEZXNjcmlwdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBydWxlRGVzY3JpcHRpb24ucHJvY2VzcyA9IHZvdGVGdW5jdGlvbjtcbiAgICB9XG5cbiAgICByZXR1cm4gcnVsZURlc2NyaXB0aW9uO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB2b3RlO1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzL3V0aWxzJyksXG4gICAgcnVsZVJlZ2V4cCA9IC9eKFd8UnVsZSkoWzAtOV17MSwzfSkkL2k7XG5cbnZhciBwYXJzZVJ1bGVTdHJpbmcgPSBmdW5jdGlvbiAocnVsZVN0cmluZykge1xuICAgIHZhciBleHRyYWN0ZWRSdWxlID0gcnVsZVJlZ2V4cC5leGVjKHV0aWxzLnN0cmlwV2hpdGVzcGFjZXMocnVsZVN0cmluZykpLFxuICAgICAgICBydWxlTnVtYmVyID0gZXh0cmFjdGVkUnVsZSA/IHBhcnNlSW50KGV4dHJhY3RlZFJ1bGVbMl0sIDEwKSA6IG51bGw7XG5cbiAgICByZXR1cm4gZXh0cmFjdGVkUnVsZSAmJiBydWxlTnVtYmVyID49IDAgJiYgcnVsZU51bWJlciA8PSAyNTUgPyB7XG4gICAgICAgIHJ1bGVGb3JtYXQ6ICd3b2xmcmFtJyxcbiAgICAgICAgcnVsZVN0cmluZzogcnVsZVN0cmluZyxcbiAgICAgICAgcnVsZU51bWJlcjogcnVsZU51bWJlcixcbiAgICAgICAgbmVpZ2hib3VyaG9vZFR5cGU6ICd2b24tbmV1bWFubicsXG4gICAgICAgIG5laWdoYm91cmhvb2RSYW5nZTogMVxuICAgIH0gOiBudWxsO1xufTtcblxudmFyIHdvbGZyYW1GdW5jdGlvbiA9IGZ1bmN0aW9uIChjdXJyZW50VmFsdWUsIG5laWdoYm91cnMpIHtcbiAgICB2YXIgYmluYXJ5U3RhdGUgPSAobmVpZ2hib3Vyc1swXSA/IDQgOiAwKSArIChjdXJyZW50VmFsdWUgPyAyIDogMCkgKyAobmVpZ2hib3Vyc1sxXSA/IDEgOiAwKTtcblxuICAgIHJldHVybiAodGhpcy5ydWxlTnVtYmVyICYgTWF0aC5wb3coMiwgYmluYXJ5U3RhdGUpID8gMSA6IDApO1xufTtcblxudmFyIHdvbGZyYW0gPSBmdW5jdGlvbiAocnVsZSkge1xuICAgIHZhciBydWxlRGVzY3JpcHRpb24gPSBwYXJzZVJ1bGVTdHJpbmcocnVsZSk7XG5cbiAgICBpZiAocnVsZURlc2NyaXB0aW9uICE9PSBudWxsKSB7XG4gICAgICAgIHJ1bGVEZXNjcmlwdGlvbi5wcm9jZXNzID0gd29sZnJhbUZ1bmN0aW9uO1xuICAgIH1cblxuICAgIHJldHVybiBydWxlRGVzY3JpcHRpb247XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHdvbGZyYW07XG4iLCJcInVzZSBzdHJpY3RcIjtcblxudmFyIGZvcm1hdHMgPSB7XG4gICAgbGlmZTogcmVxdWlyZSgnLi9mb3JtYXRzL2xpZmUnKSxcbiAgICBleHRlbmRlZExpZmU6IHJlcXVpcmUoJy4vZm9ybWF0cy9leHRlbmRlZExpZmUnKSxcbiAgICBleHRlbmRlZFN0b2NoYXN0aWM6IHJlcXVpcmUoJy4vZm9ybWF0cy9leHRlbmRlZFN0b2NoYXN0aWMnKSxcbiAgICBnZW5lcmF0aW9uczogcmVxdWlyZSgnLi9mb3JtYXRzL2dlbmVyYXRpb25zJyksXG4gICAgZXh0ZW5kZWRHZW5lcmF0aW9uczogcmVxdWlyZSgnLi9mb3JtYXRzL2V4dGVuZGVkR2VuZXJhdGlvbnMnKSxcbiAgICBjeWNsaWM6IHJlcXVpcmUoJy4vZm9ybWF0cy9jeWNsaWMnKSxcbiAgICB2b3RlOiByZXF1aXJlKCcuL2Zvcm1hdHMvdm90ZScpLFxuICAgIHdvbGZyYW06IHJlcXVpcmUoJy4vZm9ybWF0cy93b2xmcmFtJyksXG4gICAgbHVreTogcmVxdWlyZSgnLi9mb3JtYXRzL2x1a3knKSxcbiAgICBubHVreTogcmVxdWlyZSgnLi9mb3JtYXRzL25sdWt5Jylcbn07XG5cbnZhciBwYXJzZXIgPSBmdW5jdGlvbiBwYXJzZXIgKHJ1bGVTdHJpbmcsIGZvcm1hdCkge1xuICAgIHZhciByZXN1bHQgPSBudWxsO1xuXG4gICAgaWYgKHR5cGVvZiBydWxlU3RyaW5nID09PSAnc3RyaW5nJykge1xuICAgICAgICBpZiAoISFmb3JtYXQpIHtcbiAgICAgICAgICAgIHJlc3VsdCA9ICEhZm9ybWF0c1tmb3JtYXRdID8gZm9ybWF0c1tmb3JtYXRdKHJ1bGVTdHJpbmcpIDogbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoZm9ybWF0IGluIGZvcm1hdHMpIHtcbiAgICAgICAgICAgICAgICBpZiAoZm9ybWF0cy5oYXNPd25Qcm9wZXJ0eShmb3JtYXQpKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdCA9IGZvcm1hdHNbZm9ybWF0XShydWxlU3RyaW5nKTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAocmVzdWx0ICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHBhcnNlcjtcbiIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgdXRpbHMgPSB7fTtcblxudXRpbHMuc3RyaXBXaGl0ZXNwYWNlcyA9IGZ1bmN0aW9uIChzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1xccy9nLCAnJyk7XG59O1xuXG51dGlscy5zcGxpdFN0cmluZ0luTnVtYmVyQXJyYXkgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gICAgcmV0dXJuIHN0cmluZy5zcGxpdCgnJykubWFwKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgICAgICByZXR1cm4gcGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgICB9KTtcbn07XG5cbnZhciByZWdleFJhbmdlID0gLyhbMC05XSspXFwuXFwuKFswLTldKykvO1xuXG51dGlscy5zcGxpdENvbW1hU2VwYXJhdGVkTnVtYmVyc1dpdGhSYW5nZXMgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gICAgdmFyIHNwbGl0U3RyaW5nID0gc3RyaW5nLnNwbGl0KCcsJyksXG4gICAgICAgIHJlc3VsdCA9IFtdLFxuICAgICAgICBleHByZXNzaW9uLFxuICAgICAgICByYW5nZU1hdGNoLFxuICAgICAgICBpID0gMDtcblxuICAgIGZvciAoOyBpIDwgc3BsaXRTdHJpbmcubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZXhwcmVzc2lvbiA9IHNwbGl0U3RyaW5nW2ldO1xuICAgICAgICByYW5nZU1hdGNoID0gcmVnZXhSYW5nZS5leGVjKGV4cHJlc3Npb24pO1xuXG4gICAgICAgIGlmIChyYW5nZU1hdGNoKSB7XG4gICAgICAgICAgICB1dGlscy5hcHBlbmRSYW5nZVRvQXJyYXkocGFyc2VJbnQocmFuZ2VNYXRjaFsxXSwgMTApLCBwYXJzZUludChyYW5nZU1hdGNoWzJdLCAxMCksIHJlc3VsdCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHQucHVzaChwYXJzZUludChleHByZXNzaW9uLCAxMCkpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdC5maWx0ZXIoZnVuY3Rpb24gKHYpIHtcbiAgICAgICAgcmV0dXJuICFpc05hTih2KTtcbiAgICB9KTtcbn07XG5cbnV0aWxzLmFwcGVuZFJhbmdlVG9BcnJheSA9IGZ1bmN0aW9uIChtaW4sIG1heCwgYXJyYXkpIHtcbiAgICB2YXIgdG1wO1xuXG4gICAgaWYgKG1pbiA+IG1heCkge1xuICAgICAgICB0bXAgPSBtYXg7XG4gICAgICAgIG1heCA9IG1pbjtcbiAgICAgICAgbWluID0gdG1wO1xuICAgIH1cblxuICAgIGZvciAoOyBtaW4gPD0gbWF4OyBtaW4rKykge1xuICAgICAgICBhcnJheS5wdXNoKG1pbik7XG4gICAgfVxufTtcblxudXRpbHMuYXBwZW5kUmFuZ2VUb09iamVjdFdpdGhQcm9iYWJpbGl0eSA9IGZ1bmN0aW9uIChtaW4sIG1heCwgcHJvYmFiaWxpdHksIG9iamVjdCkge1xuICAgIHZhciB0bXA7XG5cbiAgICBpZiAobWluID4gbWF4KSB7XG4gICAgICAgIHRtcCA9IG1heDtcbiAgICAgICAgbWF4ID0gbWluO1xuICAgICAgICBtaW4gPSB0bXA7XG4gICAgfVxuXG4gICAgZm9yICg7IG1pbiA8PSBtYXg7IG1pbisrKSB7XG4gICAgICAgIG9iamVjdFttaW5dID0gcHJvYmFiaWxpdHk7XG4gICAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSB1dGlscztcbiIsIlwidXNlIHN0cmljdFwiXG5cbmZ1bmN0aW9uIGlvdGEobikge1xuICB2YXIgcmVzdWx0ID0gbmV3IEFycmF5KG4pXG4gIGZvcih2YXIgaT0wOyBpPG47ICsraSkge1xuICAgIHJlc3VsdFtpXSA9IGlcbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbm1vZHVsZS5leHBvcnRzID0gaW90YSIsIi8qIVxuICogRGV0ZXJtaW5lIGlmIGFuIG9iamVjdCBpcyBhIEJ1ZmZlclxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbi8vIFRoZSBfaXNCdWZmZXIgY2hlY2sgaXMgZm9yIFNhZmFyaSA1LTcgc3VwcG9ydCwgYmVjYXVzZSBpdCdzIG1pc3Npbmdcbi8vIE9iamVjdC5wcm90b3R5cGUuY29uc3RydWN0b3IuIFJlbW92ZSB0aGlzIGV2ZW50dWFsbHlcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9iaikge1xuICByZXR1cm4gb2JqICE9IG51bGwgJiYgKGlzQnVmZmVyKG9iaikgfHwgaXNTbG93QnVmZmVyKG9iaikgfHwgISFvYmouX2lzQnVmZmVyKVxufVxuXG5mdW5jdGlvbiBpc0J1ZmZlciAob2JqKSB7XG4gIHJldHVybiAhIW9iai5jb25zdHJ1Y3RvciAmJiB0eXBlb2Ygb2JqLmNvbnN0cnVjdG9yLmlzQnVmZmVyID09PSAnZnVuY3Rpb24nICYmIG9iai5jb25zdHJ1Y3Rvci5pc0J1ZmZlcihvYmopXG59XG5cbi8vIEZvciBOb2RlIHYwLjEwIHN1cHBvcnQuIFJlbW92ZSB0aGlzIGV2ZW50dWFsbHkuXG5mdW5jdGlvbiBpc1Nsb3dCdWZmZXIgKG9iaikge1xuICByZXR1cm4gdHlwZW9mIG9iai5yZWFkRmxvYXRMRSA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2Ygb2JqLnNsaWNlID09PSAnZnVuY3Rpb24nICYmIGlzQnVmZmVyKG9iai5zbGljZSgwLCAwKSlcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gbW9vcmVcblxuZnVuY3Rpb24gbW9vcmUocmFuZ2UsIGRpbXMpIHtcbiAgZGltcyA9IGRpbXMgfHwgMlxuICByYW5nZSA9IHJhbmdlIHx8IDFcbiAgcmV0dXJuIHJlY3Vyc2UoW10sIFtdLCAwKVxuXG4gIGZ1bmN0aW9uIHJlY3Vyc2UoYXJyYXksIHRlbXAsIGQpIHtcbiAgICBpZiAoZCA9PT0gZGltcy0xKSB7XG4gICAgICBmb3IgKHZhciBpID0gLXJhbmdlOyBpIDw9IHJhbmdlOyBpICs9IDEpIHtcbiAgICAgICAgaWYgKGkgfHwgdGVtcC5zb21lKGZ1bmN0aW9uKG4pIHtcbiAgICAgICAgICByZXR1cm4gblxuICAgICAgICB9KSkgYXJyYXkucHVzaCh0ZW1wLmNvbmNhdChpKSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZm9yICh2YXIgaSA9IC1yYW5nZTsgaSA8PSByYW5nZTsgaSArPSAxKSB7XG4gICAgICAgIHJlY3Vyc2UoYXJyYXksIHRlbXAuY29uY2F0KGkpLCBkKzEpXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBhcnJheVxuICB9XG59XG4iLCJ2YXIgaW90YSA9IHJlcXVpcmUoXCJpb3RhLWFycmF5XCIpXG52YXIgaXNCdWZmZXIgPSByZXF1aXJlKFwiaXMtYnVmZmVyXCIpXG5cbnZhciBoYXNUeXBlZEFycmF5cyAgPSAoKHR5cGVvZiBGbG9hdDY0QXJyYXkpICE9PSBcInVuZGVmaW5lZFwiKVxuXG5mdW5jdGlvbiBjb21wYXJlMXN0KGEsIGIpIHtcbiAgcmV0dXJuIGFbMF0gLSBiWzBdXG59XG5cbmZ1bmN0aW9uIG9yZGVyKCkge1xuICB2YXIgc3RyaWRlID0gdGhpcy5zdHJpZGVcbiAgdmFyIHRlcm1zID0gbmV3IEFycmF5KHN0cmlkZS5sZW5ndGgpXG4gIHZhciBpXG4gIGZvcihpPTA7IGk8dGVybXMubGVuZ3RoOyArK2kpIHtcbiAgICB0ZXJtc1tpXSA9IFtNYXRoLmFicyhzdHJpZGVbaV0pLCBpXVxuICB9XG4gIHRlcm1zLnNvcnQoY29tcGFyZTFzdClcbiAgdmFyIHJlc3VsdCA9IG5ldyBBcnJheSh0ZXJtcy5sZW5ndGgpXG4gIGZvcihpPTA7IGk8cmVzdWx0Lmxlbmd0aDsgKytpKSB7XG4gICAgcmVzdWx0W2ldID0gdGVybXNbaV1bMV1cbiAgfVxuICByZXR1cm4gcmVzdWx0XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVDb25zdHJ1Y3RvcihkdHlwZSwgZGltZW5zaW9uKSB7XG4gIHZhciBjbGFzc05hbWUgPSBbXCJWaWV3XCIsIGRpbWVuc2lvbiwgXCJkXCIsIGR0eXBlXS5qb2luKFwiXCIpXG4gIGlmKGRpbWVuc2lvbiA8IDApIHtcbiAgICBjbGFzc05hbWUgPSBcIlZpZXdfTmlsXCIgKyBkdHlwZVxuICB9XG4gIHZhciB1c2VHZXR0ZXJzID0gKGR0eXBlID09PSBcImdlbmVyaWNcIilcblxuICBpZihkaW1lbnNpb24gPT09IC0xKSB7XG4gICAgLy9TcGVjaWFsIGNhc2UgZm9yIHRyaXZpYWwgYXJyYXlzXG4gICAgdmFyIGNvZGUgPVxuICAgICAgXCJmdW5jdGlvbiBcIitjbGFzc05hbWUrXCIoYSl7dGhpcy5kYXRhPWE7fTtcXFxudmFyIHByb3RvPVwiK2NsYXNzTmFtZStcIi5wcm90b3R5cGU7XFxcbnByb3RvLmR0eXBlPSdcIitkdHlwZStcIic7XFxcbnByb3RvLmluZGV4PWZ1bmN0aW9uKCl7cmV0dXJuIC0xfTtcXFxucHJvdG8uc2l6ZT0wO1xcXG5wcm90by5kaW1lbnNpb249LTE7XFxcbnByb3RvLnNoYXBlPXByb3RvLnN0cmlkZT1wcm90by5vcmRlcj1bXTtcXFxucHJvdG8ubG89cHJvdG8uaGk9cHJvdG8udHJhbnNwb3NlPXByb3RvLnN0ZXA9XFxcbmZ1bmN0aW9uKCl7cmV0dXJuIG5ldyBcIitjbGFzc05hbWUrXCIodGhpcy5kYXRhKTt9O1xcXG5wcm90by5nZXQ9cHJvdG8uc2V0PWZ1bmN0aW9uKCl7fTtcXFxucHJvdG8ucGljaz1mdW5jdGlvbigpe3JldHVybiBudWxsfTtcXFxucmV0dXJuIGZ1bmN0aW9uIGNvbnN0cnVjdF9cIitjbGFzc05hbWUrXCIoYSl7cmV0dXJuIG5ldyBcIitjbGFzc05hbWUrXCIoYSk7fVwiXG4gICAgdmFyIHByb2NlZHVyZSA9IG5ldyBGdW5jdGlvbihjb2RlKVxuICAgIHJldHVybiBwcm9jZWR1cmUoKVxuICB9IGVsc2UgaWYoZGltZW5zaW9uID09PSAwKSB7XG4gICAgLy9TcGVjaWFsIGNhc2UgZm9yIDBkIGFycmF5c1xuICAgIHZhciBjb2RlID1cbiAgICAgIFwiZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiKGEsZCkge1xcXG50aGlzLmRhdGEgPSBhO1xcXG50aGlzLm9mZnNldCA9IGRcXFxufTtcXFxudmFyIHByb3RvPVwiK2NsYXNzTmFtZStcIi5wcm90b3R5cGU7XFxcbnByb3RvLmR0eXBlPSdcIitkdHlwZStcIic7XFxcbnByb3RvLmluZGV4PWZ1bmN0aW9uKCl7cmV0dXJuIHRoaXMub2Zmc2V0fTtcXFxucHJvdG8uZGltZW5zaW9uPTA7XFxcbnByb3RvLnNpemU9MTtcXFxucHJvdG8uc2hhcGU9XFxcbnByb3RvLnN0cmlkZT1cXFxucHJvdG8ub3JkZXI9W107XFxcbnByb3RvLmxvPVxcXG5wcm90by5oaT1cXFxucHJvdG8udHJhbnNwb3NlPVxcXG5wcm90by5zdGVwPWZ1bmN0aW9uIFwiK2NsYXNzTmFtZStcIl9jb3B5KCkge1xcXG5yZXR1cm4gbmV3IFwiK2NsYXNzTmFtZStcIih0aGlzLmRhdGEsdGhpcy5vZmZzZXQpXFxcbn07XFxcbnByb3RvLnBpY2s9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX3BpY2soKXtcXFxucmV0dXJuIFRyaXZpYWxBcnJheSh0aGlzLmRhdGEpO1xcXG59O1xcXG5wcm90by52YWx1ZU9mPXByb3RvLmdldD1mdW5jdGlvbiBcIitjbGFzc05hbWUrXCJfZ2V0KCl7XFxcbnJldHVybiBcIisodXNlR2V0dGVycyA/IFwidGhpcy5kYXRhLmdldCh0aGlzLm9mZnNldClcIiA6IFwidGhpcy5kYXRhW3RoaXMub2Zmc2V0XVwiKStcblwifTtcXFxucHJvdG8uc2V0PWZ1bmN0aW9uIFwiK2NsYXNzTmFtZStcIl9zZXQodil7XFxcbnJldHVybiBcIisodXNlR2V0dGVycyA/IFwidGhpcy5kYXRhLnNldCh0aGlzLm9mZnNldCx2KVwiIDogXCJ0aGlzLmRhdGFbdGhpcy5vZmZzZXRdPXZcIikrXCJcXFxufTtcXFxucmV0dXJuIGZ1bmN0aW9uIGNvbnN0cnVjdF9cIitjbGFzc05hbWUrXCIoYSxiLGMsZCl7cmV0dXJuIG5ldyBcIitjbGFzc05hbWUrXCIoYSxkKX1cIlxuICAgIHZhciBwcm9jZWR1cmUgPSBuZXcgRnVuY3Rpb24oXCJUcml2aWFsQXJyYXlcIiwgY29kZSlcbiAgICByZXR1cm4gcHJvY2VkdXJlKENBQ0hFRF9DT05TVFJVQ1RPUlNbZHR5cGVdWzBdKVxuICB9XG5cbiAgdmFyIGNvZGUgPSBbXCIndXNlIHN0cmljdCdcIl1cblxuICAvL0NyZWF0ZSBjb25zdHJ1Y3RvciBmb3Igdmlld1xuICB2YXIgaW5kaWNlcyA9IGlvdGEoZGltZW5zaW9uKVxuICB2YXIgYXJncyA9IGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHsgcmV0dXJuIFwiaVwiK2kgfSlcbiAgdmFyIGluZGV4X3N0ciA9IFwidGhpcy5vZmZzZXQrXCIgKyBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICAgIHJldHVybiBcInRoaXMuc3RyaWRlW1wiICsgaSArIFwiXSppXCIgKyBpXG4gICAgICB9KS5qb2luKFwiK1wiKVxuICB2YXIgc2hhcGVBcmcgPSBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gXCJiXCIraVxuICAgIH0pLmpvaW4oXCIsXCIpXG4gIHZhciBzdHJpZGVBcmcgPSBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gXCJjXCIraVxuICAgIH0pLmpvaW4oXCIsXCIpXG4gIGNvZGUucHVzaChcbiAgICBcImZ1bmN0aW9uIFwiK2NsYXNzTmFtZStcIihhLFwiICsgc2hhcGVBcmcgKyBcIixcIiArIHN0cmlkZUFyZyArIFwiLGQpe3RoaXMuZGF0YT1hXCIsXG4gICAgICBcInRoaXMuc2hhcGU9W1wiICsgc2hhcGVBcmcgKyBcIl1cIixcbiAgICAgIFwidGhpcy5zdHJpZGU9W1wiICsgc3RyaWRlQXJnICsgXCJdXCIsXG4gICAgICBcInRoaXMub2Zmc2V0PWR8MH1cIixcbiAgICBcInZhciBwcm90bz1cIitjbGFzc05hbWUrXCIucHJvdG90eXBlXCIsXG4gICAgXCJwcm90by5kdHlwZT0nXCIrZHR5cGUrXCInXCIsXG4gICAgXCJwcm90by5kaW1lbnNpb249XCIrZGltZW5zaW9uKVxuXG4gIC8vdmlldy5zaXplOlxuICBjb2RlLnB1c2goXCJPYmplY3QuZGVmaW5lUHJvcGVydHkocHJvdG8sJ3NpemUnLHtnZXQ6ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX3NpemUoKXtcXFxucmV0dXJuIFwiK2luZGljZXMubWFwKGZ1bmN0aW9uKGkpIHsgcmV0dXJuIFwidGhpcy5zaGFwZVtcIitpK1wiXVwiIH0pLmpvaW4oXCIqXCIpLFxuXCJ9fSlcIilcblxuICAvL3ZpZXcub3JkZXI6XG4gIGlmKGRpbWVuc2lvbiA9PT0gMSkge1xuICAgIGNvZGUucHVzaChcInByb3RvLm9yZGVyPVswXVwiKVxuICB9IGVsc2Uge1xuICAgIGNvZGUucHVzaChcIk9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm90bywnb3JkZXInLHtnZXQ6XCIpXG4gICAgaWYoZGltZW5zaW9uIDwgNCkge1xuICAgICAgY29kZS5wdXNoKFwiZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX29yZGVyKCl7XCIpXG4gICAgICBpZihkaW1lbnNpb24gPT09IDIpIHtcbiAgICAgICAgY29kZS5wdXNoKFwicmV0dXJuIChNYXRoLmFicyh0aGlzLnN0cmlkZVswXSk+TWF0aC5hYnModGhpcy5zdHJpZGVbMV0pKT9bMSwwXTpbMCwxXX19KVwiKVxuICAgICAgfSBlbHNlIGlmKGRpbWVuc2lvbiA9PT0gMykge1xuICAgICAgICBjb2RlLnB1c2goXG5cInZhciBzMD1NYXRoLmFicyh0aGlzLnN0cmlkZVswXSksczE9TWF0aC5hYnModGhpcy5zdHJpZGVbMV0pLHMyPU1hdGguYWJzKHRoaXMuc3RyaWRlWzJdKTtcXFxuaWYoczA+czEpe1xcXG5pZihzMT5zMil7XFxcbnJldHVybiBbMiwxLDBdO1xcXG59ZWxzZSBpZihzMD5zMil7XFxcbnJldHVybiBbMSwyLDBdO1xcXG59ZWxzZXtcXFxucmV0dXJuIFsxLDAsMl07XFxcbn1cXFxufWVsc2UgaWYoczA+czIpe1xcXG5yZXR1cm4gWzIsMCwxXTtcXFxufWVsc2UgaWYoczI+czEpe1xcXG5yZXR1cm4gWzAsMSwyXTtcXFxufWVsc2V7XFxcbnJldHVybiBbMCwyLDFdO1xcXG59fX0pXCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvZGUucHVzaChcIk9SREVSfSlcIilcbiAgICB9XG4gIH1cblxuICAvL3ZpZXcuc2V0KGkwLCAuLi4sIHYpOlxuICBjb2RlLnB1c2goXG5cInByb3RvLnNldD1mdW5jdGlvbiBcIitjbGFzc05hbWUrXCJfc2V0KFwiK2FyZ3Muam9pbihcIixcIikrXCIsdil7XCIpXG4gIGlmKHVzZUdldHRlcnMpIHtcbiAgICBjb2RlLnB1c2goXCJyZXR1cm4gdGhpcy5kYXRhLnNldChcIitpbmRleF9zdHIrXCIsdil9XCIpXG4gIH0gZWxzZSB7XG4gICAgY29kZS5wdXNoKFwicmV0dXJuIHRoaXMuZGF0YVtcIitpbmRleF9zdHIrXCJdPXZ9XCIpXG4gIH1cblxuICAvL3ZpZXcuZ2V0KGkwLCAuLi4pOlxuICBjb2RlLnB1c2goXCJwcm90by5nZXQ9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX2dldChcIithcmdzLmpvaW4oXCIsXCIpK1wiKXtcIilcbiAgaWYodXNlR2V0dGVycykge1xuICAgIGNvZGUucHVzaChcInJldHVybiB0aGlzLmRhdGEuZ2V0KFwiK2luZGV4X3N0citcIil9XCIpXG4gIH0gZWxzZSB7XG4gICAgY29kZS5wdXNoKFwicmV0dXJuIHRoaXMuZGF0YVtcIitpbmRleF9zdHIrXCJdfVwiKVxuICB9XG5cbiAgLy92aWV3LmluZGV4OlxuICBjb2RlLnB1c2goXG4gICAgXCJwcm90by5pbmRleD1mdW5jdGlvbiBcIitjbGFzc05hbWUrXCJfaW5kZXgoXCIsIGFyZ3Muam9pbigpLCBcIil7cmV0dXJuIFwiK2luZGV4X3N0citcIn1cIilcblxuICAvL3ZpZXcuaGkoKTpcbiAgY29kZS5wdXNoKFwicHJvdG8uaGk9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX2hpKFwiK2FyZ3Muam9pbihcIixcIikrXCIpe3JldHVybiBuZXcgXCIrY2xhc3NOYW1lK1wiKHRoaXMuZGF0YSxcIitcbiAgICBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gW1wiKHR5cGVvZiBpXCIsaSxcIiE9PSdudW1iZXInfHxpXCIsaSxcIjwwKT90aGlzLnNoYXBlW1wiLCBpLCBcIl06aVwiLCBpLFwifDBcIl0uam9pbihcIlwiKVxuICAgIH0pLmpvaW4oXCIsXCIpK1wiLFwiK1xuICAgIGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICAgIHJldHVybiBcInRoaXMuc3RyaWRlW1wiK2kgKyBcIl1cIlxuICAgIH0pLmpvaW4oXCIsXCIpK1wiLHRoaXMub2Zmc2V0KX1cIilcblxuICAvL3ZpZXcubG8oKTpcbiAgdmFyIGFfdmFycyA9IGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHsgcmV0dXJuIFwiYVwiK2krXCI9dGhpcy5zaGFwZVtcIitpK1wiXVwiIH0pXG4gIHZhciBjX3ZhcnMgPSBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7IHJldHVybiBcImNcIitpK1wiPXRoaXMuc3RyaWRlW1wiK2krXCJdXCIgfSlcbiAgY29kZS5wdXNoKFwicHJvdG8ubG89ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX2xvKFwiK2FyZ3Muam9pbihcIixcIikrXCIpe3ZhciBiPXRoaXMub2Zmc2V0LGQ9MCxcIithX3ZhcnMuam9pbihcIixcIikrXCIsXCIrY192YXJzLmpvaW4oXCIsXCIpKVxuICBmb3IodmFyIGk9MDsgaTxkaW1lbnNpb247ICsraSkge1xuICAgIGNvZGUucHVzaChcblwiaWYodHlwZW9mIGlcIitpK1wiPT09J251bWJlcicmJmlcIitpK1wiPj0wKXtcXFxuZD1pXCIraStcInwwO1xcXG5iKz1jXCIraStcIipkO1xcXG5hXCIraStcIi09ZH1cIilcbiAgfVxuICBjb2RlLnB1c2goXCJyZXR1cm4gbmV3IFwiK2NsYXNzTmFtZStcIih0aGlzLmRhdGEsXCIrXG4gICAgaW5kaWNlcy5tYXAoZnVuY3Rpb24oaSkge1xuICAgICAgcmV0dXJuIFwiYVwiK2lcbiAgICB9KS5qb2luKFwiLFwiKStcIixcIitcbiAgICBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gXCJjXCIraVxuICAgIH0pLmpvaW4oXCIsXCIpK1wiLGIpfVwiKVxuXG4gIC8vdmlldy5zdGVwKCk6XG4gIGNvZGUucHVzaChcInByb3RvLnN0ZXA9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX3N0ZXAoXCIrYXJncy5qb2luKFwiLFwiKStcIil7dmFyIFwiK1xuICAgIGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICAgIHJldHVybiBcImFcIitpK1wiPXRoaXMuc2hhcGVbXCIraStcIl1cIlxuICAgIH0pLmpvaW4oXCIsXCIpK1wiLFwiK1xuICAgIGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICAgIHJldHVybiBcImJcIitpK1wiPXRoaXMuc3RyaWRlW1wiK2krXCJdXCJcbiAgICB9KS5qb2luKFwiLFwiKStcIixjPXRoaXMub2Zmc2V0LGQ9MCxjZWlsPU1hdGguY2VpbFwiKVxuICBmb3IodmFyIGk9MDsgaTxkaW1lbnNpb247ICsraSkge1xuICAgIGNvZGUucHVzaChcblwiaWYodHlwZW9mIGlcIitpK1wiPT09J251bWJlcicpe1xcXG5kPWlcIitpK1wifDA7XFxcbmlmKGQ8MCl7XFxcbmMrPWJcIitpK1wiKihhXCIraStcIi0xKTtcXFxuYVwiK2krXCI9Y2VpbCgtYVwiK2krXCIvZClcXFxufWVsc2V7XFxcbmFcIitpK1wiPWNlaWwoYVwiK2krXCIvZClcXFxufVxcXG5iXCIraStcIio9ZFxcXG59XCIpXG4gIH1cbiAgY29kZS5wdXNoKFwicmV0dXJuIG5ldyBcIitjbGFzc05hbWUrXCIodGhpcy5kYXRhLFwiK1xuICAgIGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICAgIHJldHVybiBcImFcIiArIGlcbiAgICB9KS5qb2luKFwiLFwiKStcIixcIitcbiAgICBpbmRpY2VzLm1hcChmdW5jdGlvbihpKSB7XG4gICAgICByZXR1cm4gXCJiXCIgKyBpXG4gICAgfSkuam9pbihcIixcIikrXCIsYyl9XCIpXG5cbiAgLy92aWV3LnRyYW5zcG9zZSgpOlxuICB2YXIgdFNoYXBlID0gbmV3IEFycmF5KGRpbWVuc2lvbilcbiAgdmFyIHRTdHJpZGUgPSBuZXcgQXJyYXkoZGltZW5zaW9uKVxuICBmb3IodmFyIGk9MDsgaTxkaW1lbnNpb247ICsraSkge1xuICAgIHRTaGFwZVtpXSA9IFwiYVtpXCIraStcIl1cIlxuICAgIHRTdHJpZGVbaV0gPSBcImJbaVwiK2krXCJdXCJcbiAgfVxuICBjb2RlLnB1c2goXCJwcm90by50cmFuc3Bvc2U9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX3RyYW5zcG9zZShcIithcmdzK1wiKXtcIitcbiAgICBhcmdzLm1hcChmdW5jdGlvbihuLGlkeCkgeyByZXR1cm4gbiArIFwiPShcIiArIG4gKyBcIj09PXVuZGVmaW5lZD9cIiArIGlkeCArIFwiOlwiICsgbiArIFwifDApXCJ9KS5qb2luKFwiO1wiKSxcbiAgICBcInZhciBhPXRoaXMuc2hhcGUsYj10aGlzLnN0cmlkZTtyZXR1cm4gbmV3IFwiK2NsYXNzTmFtZStcIih0aGlzLmRhdGEsXCIrdFNoYXBlLmpvaW4oXCIsXCIpK1wiLFwiK3RTdHJpZGUuam9pbihcIixcIikrXCIsdGhpcy5vZmZzZXQpfVwiKVxuXG4gIC8vdmlldy5waWNrKCk6XG4gIGNvZGUucHVzaChcInByb3RvLnBpY2s9ZnVuY3Rpb24gXCIrY2xhc3NOYW1lK1wiX3BpY2soXCIrYXJncytcIil7dmFyIGE9W10sYj1bXSxjPXRoaXMub2Zmc2V0XCIpXG4gIGZvcih2YXIgaT0wOyBpPGRpbWVuc2lvbjsgKytpKSB7XG4gICAgY29kZS5wdXNoKFwiaWYodHlwZW9mIGlcIitpK1wiPT09J251bWJlcicmJmlcIitpK1wiPj0wKXtjPShjK3RoaXMuc3RyaWRlW1wiK2krXCJdKmlcIitpK1wiKXwwfWVsc2V7YS5wdXNoKHRoaXMuc2hhcGVbXCIraStcIl0pO2IucHVzaCh0aGlzLnN0cmlkZVtcIitpK1wiXSl9XCIpXG4gIH1cbiAgY29kZS5wdXNoKFwidmFyIGN0b3I9Q1RPUl9MSVNUW2EubGVuZ3RoKzFdO3JldHVybiBjdG9yKHRoaXMuZGF0YSxhLGIsYyl9XCIpXG5cbiAgLy9BZGQgcmV0dXJuIHN0YXRlbWVudFxuICBjb2RlLnB1c2goXCJyZXR1cm4gZnVuY3Rpb24gY29uc3RydWN0X1wiK2NsYXNzTmFtZStcIihkYXRhLHNoYXBlLHN0cmlkZSxvZmZzZXQpe3JldHVybiBuZXcgXCIrY2xhc3NOYW1lK1wiKGRhdGEsXCIrXG4gICAgaW5kaWNlcy5tYXAoZnVuY3Rpb24oaSkge1xuICAgICAgcmV0dXJuIFwic2hhcGVbXCIraStcIl1cIlxuICAgIH0pLmpvaW4oXCIsXCIpK1wiLFwiK1xuICAgIGluZGljZXMubWFwKGZ1bmN0aW9uKGkpIHtcbiAgICAgIHJldHVybiBcInN0cmlkZVtcIitpK1wiXVwiXG4gICAgfSkuam9pbihcIixcIikrXCIsb2Zmc2V0KX1cIilcblxuICAvL0NvbXBpbGUgcHJvY2VkdXJlXG4gIHZhciBwcm9jZWR1cmUgPSBuZXcgRnVuY3Rpb24oXCJDVE9SX0xJU1RcIiwgXCJPUkRFUlwiLCBjb2RlLmpvaW4oXCJcXG5cIikpXG4gIHJldHVybiBwcm9jZWR1cmUoQ0FDSEVEX0NPTlNUUlVDVE9SU1tkdHlwZV0sIG9yZGVyKVxufVxuXG5mdW5jdGlvbiBhcnJheURUeXBlKGRhdGEpIHtcbiAgaWYoaXNCdWZmZXIoZGF0YSkpIHtcbiAgICByZXR1cm4gXCJidWZmZXJcIlxuICB9XG4gIGlmKGhhc1R5cGVkQXJyYXlzKSB7XG4gICAgc3dpdGNoKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChkYXRhKSkge1xuICAgICAgY2FzZSBcIltvYmplY3QgRmxvYXQ2NEFycmF5XVwiOlxuICAgICAgICByZXR1cm4gXCJmbG9hdDY0XCJcbiAgICAgIGNhc2UgXCJbb2JqZWN0IEZsb2F0MzJBcnJheV1cIjpcbiAgICAgICAgcmV0dXJuIFwiZmxvYXQzMlwiXG4gICAgICBjYXNlIFwiW29iamVjdCBJbnQ4QXJyYXldXCI6XG4gICAgICAgIHJldHVybiBcImludDhcIlxuICAgICAgY2FzZSBcIltvYmplY3QgSW50MTZBcnJheV1cIjpcbiAgICAgICAgcmV0dXJuIFwiaW50MTZcIlxuICAgICAgY2FzZSBcIltvYmplY3QgSW50MzJBcnJheV1cIjpcbiAgICAgICAgcmV0dXJuIFwiaW50MzJcIlxuICAgICAgY2FzZSBcIltvYmplY3QgVWludDhBcnJheV1cIjpcbiAgICAgICAgcmV0dXJuIFwidWludDhcIlxuICAgICAgY2FzZSBcIltvYmplY3QgVWludDE2QXJyYXldXCI6XG4gICAgICAgIHJldHVybiBcInVpbnQxNlwiXG4gICAgICBjYXNlIFwiW29iamVjdCBVaW50MzJBcnJheV1cIjpcbiAgICAgICAgcmV0dXJuIFwidWludDMyXCJcbiAgICAgIGNhc2UgXCJbb2JqZWN0IFVpbnQ4Q2xhbXBlZEFycmF5XVwiOlxuICAgICAgICByZXR1cm4gXCJ1aW50OF9jbGFtcGVkXCJcbiAgICB9XG4gIH1cbiAgaWYoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgIHJldHVybiBcImFycmF5XCJcbiAgfVxuICByZXR1cm4gXCJnZW5lcmljXCJcbn1cblxudmFyIENBQ0hFRF9DT05TVFJVQ1RPUlMgPSB7XG4gIFwiZmxvYXQzMlwiOltdLFxuICBcImZsb2F0NjRcIjpbXSxcbiAgXCJpbnQ4XCI6W10sXG4gIFwiaW50MTZcIjpbXSxcbiAgXCJpbnQzMlwiOltdLFxuICBcInVpbnQ4XCI6W10sXG4gIFwidWludDE2XCI6W10sXG4gIFwidWludDMyXCI6W10sXG4gIFwiYXJyYXlcIjpbXSxcbiAgXCJ1aW50OF9jbGFtcGVkXCI6W10sXG4gIFwiYnVmZmVyXCI6W10sXG4gIFwiZ2VuZXJpY1wiOltdXG59XG5cbjsoZnVuY3Rpb24oKSB7XG4gIGZvcih2YXIgaWQgaW4gQ0FDSEVEX0NPTlNUUlVDVE9SUykge1xuICAgIENBQ0hFRF9DT05TVFJVQ1RPUlNbaWRdLnB1c2goY29tcGlsZUNvbnN0cnVjdG9yKGlkLCAtMSkpXG4gIH1cbn0pO1xuXG5mdW5jdGlvbiB3cmFwcGVkTkRBcnJheUN0b3IoZGF0YSwgc2hhcGUsIHN0cmlkZSwgb2Zmc2V0KSB7XG4gIGlmKGRhdGEgPT09IHVuZGVmaW5lZCkge1xuICAgIHZhciBjdG9yID0gQ0FDSEVEX0NPTlNUUlVDVE9SUy5hcnJheVswXVxuICAgIHJldHVybiBjdG9yKFtdKVxuICB9IGVsc2UgaWYodHlwZW9mIGRhdGEgPT09IFwibnVtYmVyXCIpIHtcbiAgICBkYXRhID0gW2RhdGFdXG4gIH1cbiAgaWYoc2hhcGUgPT09IHVuZGVmaW5lZCkge1xuICAgIHNoYXBlID0gWyBkYXRhLmxlbmd0aCBdXG4gIH1cbiAgdmFyIGQgPSBzaGFwZS5sZW5ndGhcbiAgaWYoc3RyaWRlID09PSB1bmRlZmluZWQpIHtcbiAgICBzdHJpZGUgPSBuZXcgQXJyYXkoZClcbiAgICBmb3IodmFyIGk9ZC0xLCBzej0xOyBpPj0wOyAtLWkpIHtcbiAgICAgIHN0cmlkZVtpXSA9IHN6XG4gICAgICBzeiAqPSBzaGFwZVtpXVxuICAgIH1cbiAgfVxuICBpZihvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIG9mZnNldCA9IDBcbiAgICBmb3IodmFyIGk9MDsgaTxkOyArK2kpIHtcbiAgICAgIGlmKHN0cmlkZVtpXSA8IDApIHtcbiAgICAgICAgb2Zmc2V0IC09IChzaGFwZVtpXS0xKSpzdHJpZGVbaV1cbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgdmFyIGR0eXBlID0gYXJyYXlEVHlwZShkYXRhKVxuICB2YXIgY3Rvcl9saXN0ID0gQ0FDSEVEX0NPTlNUUlVDVE9SU1tkdHlwZV1cbiAgd2hpbGUoY3Rvcl9saXN0Lmxlbmd0aCA8PSBkKzEpIHtcbiAgICBjdG9yX2xpc3QucHVzaChjb21waWxlQ29uc3RydWN0b3IoZHR5cGUsIGN0b3JfbGlzdC5sZW5ndGgtMSkpXG4gIH1cbiAgdmFyIGN0b3IgPSBjdG9yX2xpc3RbZCsxXVxuICByZXR1cm4gY3RvcihkYXRhLCBzaGFwZSwgc3RyaWRlLCBvZmZzZXQpXG59XG5cbm1vZHVsZS5leHBvcnRzID0gd3JhcHBlZE5EQXJyYXlDdG9yXG4iLCJtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGF4aXMgKHJhbmdlLCBkaW1zKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBkaW1zID0gZGltcyB8fCAyO1xuICAgIHJhbmdlID0gcmFuZ2UgfHwgMTtcblxuICAgIHJldHVybiByZWN1cnNlKFtdLCBbXSwgMCk7XG5cbiAgICBmdW5jdGlvbiByZWN1cnNlIChhcnJheSwgdGVtcCwgZCkge1xuICAgICAgICB2YXIgaSxcbiAgICAgICAgICAgIGssXG4gICAgICAgICAgICBtYXRjaDtcblxuICAgICAgICBpZiAoZCA9PT0gZGltcy0xKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAtcmFuZ2U7IGkgPD0gcmFuZ2U7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIG1hdGNoID0gKGkgPT09IDAgPyAxIDogMCk7XG4gICAgICAgICAgICAgICAgZm9yIChrID0gMDsgayA8IGRpbXM7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICBtYXRjaCs9ICh0ZW1wW2tdID09PSAwID8gMSA6IDApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChtYXRjaCA9PT0gZGltcy0xKSB7XG4gICAgICAgICAgICAgICAgICAgIGFycmF5LnB1c2godGVtcC5jb25jYXQoaSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoaSA9IC1yYW5nZTsgaSA8PSByYW5nZTsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgcmVjdXJzZShhcnJheSwgdGVtcC5jb25jYXQoaSksIGQgKyAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcnJheTtcbiAgICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBjb3JuZXIgKHJhbmdlLCBkaW1zKSB7XG4gICAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgICBkaW1zID0gZGltcyB8fCAyO1xuICAgIHJhbmdlID0gcmFuZ2UgfHwgMTtcblxuICAgIHJldHVybiByZWN1cnNlKFtdLCBbXSwgMCk7XG5cbiAgICBmdW5jdGlvbiByZWN1cnNlIChhcnJheSwgdGVtcCwgZCkge1xuICAgICAgICB2YXIgaSxcbiAgICAgICAgICAgIGssXG4gICAgICAgICAgICBtYXRjaDtcblxuICAgICAgICBpZiAoZCA9PT0gZGltcy0xKSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAtcmFuZ2U7IGkgPD0gcmFuZ2U7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIG1hdGNoID0gKE1hdGguYWJzKGkpID09PSByYW5nZSA/IDEgOiAwKTtcbiAgICAgICAgICAgICAgICBmb3IgKGsgPSAwOyBrIDwgZGltczsgaysrKSB7XG4gICAgICAgICAgICAgICAgICAgIG1hdGNoICs9IChNYXRoLmFicyh0ZW1wW2tdKSA9PT0gcmFuZ2UgPyAxIDogMCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWYgKG1hdGNoID09PSBkaW1zKSB7XG4gICAgICAgICAgICAgICAgICAgIGFycmF5LnB1c2godGVtcC5jb25jYXQoaSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoaSA9IC1yYW5nZTsgaSA8PSByYW5nZTsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgcmVjdXJzZShhcnJheSwgdGVtcC5jb25jYXQoaSksIGQgKyAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBhcnJheTtcbiAgICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBlZGdlIChyYW5nZSwgZGltcykge1xuICAgIFwidXNlIHN0cmljdFwiO1xuXG4gICAgZGltcyA9IGRpbXMgfHwgMjtcbiAgICByYW5nZSA9IHJhbmdlIHx8IDE7XG5cbiAgICByZXR1cm4gcmVjdXJzZShbXSwgW10sIDApO1xuXG4gICAgZnVuY3Rpb24gcmVjdXJzZSAoYXJyYXksIHRlbXAsIGQpIHtcbiAgICAgICAgdmFyIGksXG4gICAgICAgICAgICBrLFxuICAgICAgICAgICAgbWF0Y2g7XG5cbiAgICAgICAgaWYgKGQgPT09IGRpbXMtMSkge1xuICAgICAgICAgICAgZm9yIChpID0gLXJhbmdlOyBpIDw9IHJhbmdlOyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICBtYXRjaCA9IChNYXRoLmFicyhpKSA9PT0gcmFuZ2UgPyAxIDogMCk7XG4gICAgICAgICAgICAgICAgZm9yIChrID0gMDsgayA8IGRpbXM7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICBtYXRjaCArPSAoTWF0aC5hYnModGVtcFtrXSkgPT09IHJhbmdlID8gMSA6IDApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChtYXRjaCA+PSBkaW1zIC0gMSkge1xuICAgICAgICAgICAgICAgICAgICBhcnJheS5wdXNoKHRlbXAuY29uY2F0KGkpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAtcmFuZ2U7IGkgPD0gcmFuZ2U7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIHJlY3Vyc2UoYXJyYXksIHRlbXAuY29uY2F0KGkpLCBkICsgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXJyYXk7XG4gICAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZmFjZSAocmFuZ2UsIGRpbXMpIHtcbiAgICBcInVzZSBzdHJpY3RcIjtcblxuICAgIGRpbXMgPSBkaW1zIHx8IDI7XG4gICAgcmFuZ2UgPSByYW5nZSB8fCAxO1xuXG4gICAgcmV0dXJuIHJlY3Vyc2UoW10sIFtdLCAwKTtcblxuICAgIGZ1bmN0aW9uIHJlY3Vyc2UgKGFycmF5LCB0ZW1wLCBkKSB7XG4gICAgICAgIHZhciBpLFxuICAgICAgICAgICAgayxcbiAgICAgICAgICAgIG1hdGNoO1xuXG4gICAgICAgIGlmIChkID09PSBkaW1zLTEpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IC1yYW5nZTsgaSA8PSByYW5nZTsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWF0Y2ggPSAoTWF0aC5hYnMoaSkgPT09IHJhbmdlKTtcbiAgICAgICAgICAgICAgICBmb3IgKGsgPSAwOyAhbWF0Y2ggJiYgayA8IGRpbXM7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICBtYXRjaCA9IChNYXRoLmFicyh0ZW1wW2tdKSA9PT0gcmFuZ2UpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgICAgICAgICBhcnJheS5wdXNoKHRlbXAuY29uY2F0KGkpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGkgPSAtcmFuZ2U7IGkgPD0gcmFuZ2U7IGkgKz0gMSkge1xuICAgICAgICAgICAgICAgIHJlY3Vyc2UoYXJyYXksIHRlbXAuY29uY2F0KGkpLCBkICsgMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXJyYXk7XG4gICAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICAgIGF4aXM6IHJlcXVpcmUoJy4vZnVuY3Rpb25zL2F4aXMnKSxcbiAgICBjb3JuZXI6IHJlcXVpcmUoJy4vZnVuY3Rpb25zL2Nvcm5lcicpLFxuICAgIGVkZ2U6IHJlcXVpcmUoJy4vZnVuY3Rpb25zL2VkZ2UnKSxcbiAgICBmYWNlOiByZXF1aXJlKCcuL2Z1bmN0aW9ucy9mYWNlJylcbn07XG4iLCJcInVzZSBzdHJpY3RcIlxuXG5mdW5jdGlvbiB1bmlxdWVfcHJlZChsaXN0LCBjb21wYXJlKSB7XG4gIHZhciBwdHIgPSAxXG4gICAgLCBsZW4gPSBsaXN0Lmxlbmd0aFxuICAgICwgYT1saXN0WzBdLCBiPWxpc3RbMF1cbiAgZm9yKHZhciBpPTE7IGk8bGVuOyArK2kpIHtcbiAgICBiID0gYVxuICAgIGEgPSBsaXN0W2ldXG4gICAgaWYoY29tcGFyZShhLCBiKSkge1xuICAgICAgaWYoaSA9PT0gcHRyKSB7XG4gICAgICAgIHB0cisrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBsaXN0W3B0cisrXSA9IGFcbiAgICB9XG4gIH1cbiAgbGlzdC5sZW5ndGggPSBwdHJcbiAgcmV0dXJuIGxpc3Rcbn1cblxuZnVuY3Rpb24gdW5pcXVlX2VxKGxpc3QpIHtcbiAgdmFyIHB0ciA9IDFcbiAgICAsIGxlbiA9IGxpc3QubGVuZ3RoXG4gICAgLCBhPWxpc3RbMF0sIGIgPSBsaXN0WzBdXG4gIGZvcih2YXIgaT0xOyBpPGxlbjsgKytpLCBiPWEpIHtcbiAgICBiID0gYVxuICAgIGEgPSBsaXN0W2ldXG4gICAgaWYoYSAhPT0gYikge1xuICAgICAgaWYoaSA9PT0gcHRyKSB7XG4gICAgICAgIHB0cisrXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBsaXN0W3B0cisrXSA9IGFcbiAgICB9XG4gIH1cbiAgbGlzdC5sZW5ndGggPSBwdHJcbiAgcmV0dXJuIGxpc3Rcbn1cblxuZnVuY3Rpb24gdW5pcXVlKGxpc3QsIGNvbXBhcmUsIHNvcnRlZCkge1xuICBpZihsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBsaXN0XG4gIH1cbiAgaWYoY29tcGFyZSkge1xuICAgIGlmKCFzb3J0ZWQpIHtcbiAgICAgIGxpc3Quc29ydChjb21wYXJlKVxuICAgIH1cbiAgICByZXR1cm4gdW5pcXVlX3ByZWQobGlzdCwgY29tcGFyZSlcbiAgfVxuICBpZighc29ydGVkKSB7XG4gICAgbGlzdC5zb3J0KClcbiAgfVxuICByZXR1cm4gdW5pcXVlX2VxKGxpc3QpXG59XG5cbm1vZHVsZS5leHBvcnRzID0gdW5pcXVlXG4iLCJtb2R1bGUuZXhwb3J0cyA9IHZvbk5ldW1hbm47XG5cbmZ1bmN0aW9uIHZvbk5ldW1hbm4ocmFuZ2UsIGRpbXMpIHtcbiAgICBkaW1zID0gZGltcyB8fCAyO1xuICAgIHJhbmdlID0gcmFuZ2UgfHwgMTtcbiAgICByZXR1cm4gcmVjdXJzZShbXSwgW10sIDApO1xuXG4gICAgZnVuY3Rpb24gcmVjdXJzZShhcnJheSwgdGVtcCwgZCkge1xuICAgICAgICB2YXIgbWFuaGF0dGFuRGlzdGFuY2UsXG4gICAgICAgICAgICBpO1xuXG4gICAgICAgIGlmIChkID09PSBkaW1zLTEpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IC1yYW5nZTsgaSA8PSByYW5nZTsgaSArPSAxKSB7XG4gICAgICAgICAgICAgICAgbWFuaGF0dGFuRGlzdGFuY2UgPSB0ZW1wLnJlZHVjZShmdW5jdGlvbiAoc3VtLCB2YWx1ZSkgeyByZXR1cm4gc3VtICsgTWF0aC5hYnModmFsdWUpOyB9LCBNYXRoLmFicyhpKSk7XG5cbiAgICAgICAgICAgICAgICBpZiAobWFuaGF0dGFuRGlzdGFuY2UgPD0gcmFuZ2UgJiYgbWFuaGF0dGFuRGlzdGFuY2UgIT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgYXJyYXkucHVzaCh0ZW1wLmNvbmNhdChpKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChpID0gLXJhbmdlOyBpIDw9IHJhbmdlOyBpICs9IDEpIHtcbiAgICAgICAgICAgICAgICByZWN1cnNlKGFycmF5LCB0ZW1wLmNvbmNhdChpKSwgZCArIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGFycmF5O1xuICAgIH1cbn1cbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbnByb2Nlc3MubmV4dFRpY2sgPSAoZnVuY3Rpb24gKCkge1xuICAgIHZhciBjYW5TZXRJbW1lZGlhdGUgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5zZXRJbW1lZGlhdGU7XG4gICAgdmFyIGNhbk11dGF0aW9uT2JzZXJ2ZXIgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5NdXRhdGlvbk9ic2VydmVyO1xuICAgIHZhciBjYW5Qb3N0ID0gdHlwZW9mIHdpbmRvdyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAmJiB3aW5kb3cucG9zdE1lc3NhZ2UgJiYgd2luZG93LmFkZEV2ZW50TGlzdGVuZXJcbiAgICA7XG5cbiAgICBpZiAoY2FuU2V0SW1tZWRpYXRlKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoZikgeyByZXR1cm4gd2luZG93LnNldEltbWVkaWF0ZShmKSB9O1xuICAgIH1cblxuICAgIHZhciBxdWV1ZSA9IFtdO1xuXG4gICAgaWYgKGNhbk11dGF0aW9uT2JzZXJ2ZXIpIHtcbiAgICAgICAgdmFyIGhpZGRlbkRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIHZhciBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBxdWV1ZUxpc3QgPSBxdWV1ZS5zbGljZSgpO1xuICAgICAgICAgICAgcXVldWUubGVuZ3RoID0gMDtcbiAgICAgICAgICAgIHF1ZXVlTGlzdC5mb3JFYWNoKGZ1bmN0aW9uIChmbikge1xuICAgICAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShoaWRkZW5EaXYsIHsgYXR0cmlidXRlczogdHJ1ZSB9KTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgICAgIGlmICghcXVldWUubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgaGlkZGVuRGl2LnNldEF0dHJpYnV0ZSgneWVzJywgJ25vJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBxdWV1ZS5wdXNoKGZuKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBpZiAoY2FuUG9zdCkge1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uIChldikge1xuICAgICAgICAgICAgdmFyIHNvdXJjZSA9IGV2LnNvdXJjZTtcbiAgICAgICAgICAgIGlmICgoc291cmNlID09PSB3aW5kb3cgfHwgc291cmNlID09PSBudWxsKSAmJiBldi5kYXRhID09PSAncHJvY2Vzcy10aWNrJykge1xuICAgICAgICAgICAgICAgIGV2LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBmbiA9IHF1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgIGZuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0cnVlKTtcblxuICAgICAgICByZXR1cm4gZnVuY3Rpb24gbmV4dFRpY2soZm4pIHtcbiAgICAgICAgICAgIHF1ZXVlLnB1c2goZm4pO1xuICAgICAgICAgICAgd2luZG93LnBvc3RNZXNzYWdlKCdwcm9jZXNzLXRpY2snLCAnKicpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICBzZXRUaW1lb3V0KGZuLCAwKTtcbiAgICB9O1xufSkoKTtcblxucHJvY2Vzcy50aXRsZSA9ICdicm93c2VyJztcbnByb2Nlc3MuYnJvd3NlciA9IHRydWU7XG5wcm9jZXNzLmVudiA9IHt9O1xucHJvY2Vzcy5hcmd2ID0gW107XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG4vLyBUT0RPKHNodHlsbWFuKVxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG4iXX0=
