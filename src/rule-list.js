"use strict";

var ruleParser = require('cellular-automata-rule-parser');

var acceptedRuleFormat = [
    'extended-stochastic',
    'extended-life',
    'life',
    'vote',
    'luky'
];

var isValidRule = function isValidRule (rule) {
    var parsedRule = ruleParser(rule);

    return parsedRule && acceptedRuleFormat.indexOf(parsedRule.ruleFormat) > -1 ;
};

var toHtml = function toHtml (value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

var moveInArray = function moveInArray (array, odlIndex, newIndex) {
    array.splice(newIndex, 0, array.splice(odlIndex, 1)[0]);
};

var RuleList = function RuleList (list, button, bin, template) {
    this.template = template.innerHTML.replace(/(<!--|-->)/g, '');
    this.rules = [];
    this.listElement = list;
    this.buttonElement = button;
    this.binElement = bin;

    this.tempElement = document.createElement('div');

    this.draggedElement = null;

    var self = this;
    this.dragStartHandler = function (e) {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('Text', '');
        this.classList.add('dragging');
        self.draggedElement = this;

        document.body.classList.add('is-dragging');
    };
    this.dragEndHandler = function () {
        this.classList.remove('dragging');
        self.draggedElement = null;

        document.body.classList.remove('is-dragging');
    };
    this.dragOverHandler = function (e) {
        e.preventDefault();

        if (this !== self.draggedElement) {
            this.classList.add('over');
        }

        e.dataTransfer.dropEffect = 'copy';

        return false;
    };
    this.dropHandler = function () {
        if (this !== self.draggedElement) {
            var targetRule = this.ruleObject,
                draggedRule = self.draggedElement.ruleObject,
                targetPos = self.rules.indexOf(targetRule),
                draggedPos = self.rules.indexOf(draggedRule);

            if(targetPos > draggedPos) {
                self.listElement.insertBefore(self.draggedElement, this.nextSibling);
                moveInArray(self.rules, draggedPos, targetPos + 1);
            } else {
                self.listElement.insertBefore(self.draggedElement, this);
                moveInArray(self.rules, draggedPos, targetPos);
            }
        }

        this.classList.remove('over');
    };
    this.dragEnterHandler = function (e) {
        if (this !== self.draggedElement) {
            this.classList.add('over');
        }
    };

    this.dragLeaveHandler = function (e) {
        this.classList.remove('over');
    };

    this.binDropHandler = function (e) {
        e.preventDefault();

        var rule = self.draggedElement.ruleObject;
        var indexRule = self.rules.indexOf(rule);
        self.rules.splice(indexRule, 1);

        self.listElement.removeChild(self.draggedElement);

        this.classList.remove('over');
    };

    this.addEvents();
};

RuleList.prototype.addEvents = function () {
    var self = this;

    this.binElement.addEventListener('dragenter', this.dragEnterHandler, false);
    this.binElement.addEventListener('dragleave', this.dragLeaveHandler, false);
    this.binElement.addEventListener('dragover', this.dragOverHandler, false);
    this.binElement.addEventListener('drop', this.binDropHandler, false);

    this.buttonElement.addEventListener('click', function () { self.addDefaultRule(); self.buttonElement.blur(); });
};

RuleList.prototype.addElementEvents = function (element) {
    var inputs = element.querySelectorAll('input'),
        i = 0;

    for (; i < inputs.length; i++) {
        inputs[i].addEventListener('change', function () {
            if (element.ruleObject.hasOwnProperty(this.name)) {
                if (this.name === 'rule') {
                    if (isValidRule(this.value)) {
                        element.ruleObject.valid = true;
                        element.classList.remove('invalid');
                    } else {
                        element.ruleObject.valid = false;
                        element.classList.add('invalid');
                    }
                }

                element.ruleObject[this.name] = this.type === 'number' ? parseInt(this.value, 10) : this.value;
            }
        });

        inputs[i].addEventListener('keyup', function () {
            if (element.ruleObject.hasOwnProperty(this.name)) {
                if (this.name === 'rule') {
                    if (isValidRule(this.value)) {
                        element.ruleObject.valid = true;
                        element.classList.remove('invalid');
                    } else {
                        element.ruleObject.valid = false;
                        element.classList.add('invalid');
                    }
                }

                element.ruleObject[this.name] = this.type === 'number' ? parseInt(this.value, 10) : this.value;
            }
        });
    }

    element.addEventListener('dragstart', this.dragStartHandler, false);
    element.addEventListener('dragend', this.dragEndHandler, false);
    element.addEventListener('dragenter', this.dragEnterHandler, false);
    element.addEventListener('dragleave', this.dragLeaveHandler, false);
    element.addEventListener('dragover', this.dragOverHandler, false);
    element.addEventListener('drop', this.dropHandler, false);
};

RuleList.prototype.createElement = function (rule, iterations, className) {
    var html = this.template.replace('{className}', className).replace('{rule}', toHtml(rule)).replace('{iterations}', parseInt(iterations, 10));

    this.tempElement.innerHTML = html.trim();

    return this.tempElement.firstChild;
};

RuleList.prototype.addRule = function (rule, iterations) {
    iterations = iterations || 0;

    var ruleObject = {
        rule: rule,
        iterations: iterations,
        valid: isValidRule(rule)
    };

    var element = this.createElement(rule, iterations, ruleObject.valid ? '' : 'invalid');
    element.ruleObject = ruleObject;

    this.rules.push(ruleObject);

    this.addElementEvents(element);
    this.listElement.appendChild(element);
};

RuleList.prototype.addDefaultRule = function () {
    this.addRule('E 2,3 / 3', 1);
};

module.exports = RuleList;
