(function() {
    /* global cooMatchCommand */
    /* global cooCreateScope */
    /* global cooPushScopeVariable */
    /* global cooValueToJS */
    /* global cooGetScopeVariablesDecl */
    /* global cooGetScopeRet */
    /* global cooProcessBlockAsValue */
    /* global COO_INTERNAL_VARIABLE_RET */
    /* global cooAssertHasSubcommands */
    /* global cooAssertValuePusher */
    /* global cooAssertNotValuePusher */

    var DOM_FUNC = 'CooCoo.DOM',
        DOM_OBJ = 'new ' + DOM_FUNC,
        eventIdentifier = 0;

    function domProcess(cmd) {
        if (!cmd.parent) {
            return cmd.parts[0];
        }

        return cooMatchCommand(cmd, {
            'DOM': {
                '(': {
                    '@': function() {
                        // DOM (expr)
                        cmd.hasSubblock = true;
                        cmd.valueRequired = false;

                        cmd.processChild = domProcessEvents;

                        cmd.getCodeBefore = function() {
                            cooAssertHasSubcommands(cmd);

                            var ret = [];

                            ret.push(DOM_OBJ);
                            ret.push('(this, ');
                            ret.push(++eventIdentifier);

                            var tmp = cooValueToJS(cmd, cmd.parts[1]);
                            if (tmp) {
                                ret.push(', ');
                                ret.push(tmp);
                            }

                            ret.push(')');

                            return ret.join('');
                        };

                        cmd.getCodeAfter = function() {
                            return ';';
                        };
                    },

                    'APPEND': {
                        '@': function() {
                            // DOM (expr) APPEND
                            //     ...
                            cmd.hasSubblock = true;
                            cmd.valueRequired = true;

                            cooCreateScope(cmd);

                            cmd.getCodeBefore = function() {
                                var ret = [];

                                ret.push(DOM_FUNC);
                                ret.push('.append(');
                                ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                ret.push(', ');
                                ret.push('(function() {');
                                ret.push(cooGetScopeVariablesDecl(cmd));

                                return ret.join('');
                            };

                            cmd.getCodeAfter = function() {
                                var ret = [],
                                    tmp = cooGetScopeRet(cmd);

                                if (tmp) {
                                    ret.push(tmp);
                                }

                                ret.push('}).call(this));');

                                return ret.join('');
                            };
                        },

                        '(': function() {
                            // DOM (expr) APPEND (expr2)
                            cmd.getCodeBefore = function() {
                                var ret = [];

                                ret.push(DOM_FUNC);
                                ret.push('.append(');
                                ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                ret.push(', ');
                                ret.push(cooValueToJS(cmd, cmd.parts[3]));
                                ret.push(')');

                                return ret.join('');
                            };
                        }
                    },

                    'CLASS': {
                        'ADD': {
                            '(': function() {
                                // DOM (expr) CLASS ADD (expr2)
                            }
                        },

                        'REMOVE': {
                            '(': function() {
                                // DOM (expr) CLASS REMOVE (expr2)
                            }
                        }
                    },

                    'TRIGGER': {
                        '': {
                            '@': function() {
                                // DOM (expr) TRIGGER identifier
                                //     ...
                            },

                            '#': function() {
                                // DOM (expr) TRIGGER identifier (expr) (expr2) ...
                            }
                        }
                    },

                    'VALUE': {
                        'SET': {
                            '@': function() {
                                // DOM (expr) VALUE SET
                                //     ...
                                cooAssertNotValuePusher(cmd);

                                return cooProcessBlockAsValue(cmd, {
                                    getCodeBeforeBefore: function() {
                                        var ret = [];

                                        ret.push(DOM_FUNC);
                                        ret.push('.val(');
                                        ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                        ret.push(', ');

                                        return ret.join('');
                                    },

                                    getCodeAfterAfter: function() {
                                        return ');';
                                    }
                                });
                            },

                            '(': function() {
                                // DOM (expr) VALUE SET (expr2)
                                cooAssertNotValuePusher(cmd);

                                cmd.getCodeBefore = function() {
                                    var ret = [];

                                    ret.push(DOM_FUNC);
                                    ret.push('.val(');
                                    ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                    ret.push(', ');
                                    ret.push(cooValueToJS(cmd, cmd.parts[4]));
                                    ret.push(');');

                                    return ret.join('');
                                };
                            }
                        },

                        'GET': function() {
                            // DOM (expr) VALUE GET
                            cooAssertValuePusher(cmd);

                            cmd.getCodeBefore = function() {
                                var ret = [];

                                ret.push(COO_INTERNAL_VARIABLE_RET);
                                ret.push('.push(');
                                ret.push(DOM_FUNC);
                                ret.push('.val(');
                                ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                ret.push('));');

                                return ret.join('');
                            };
                        }
                    },

                    'TEXT': {
                        '@': function() {
                            // DOM (expr) TEXT
                            //     ...
                            return cooProcessBlockAsValue(cmd, {
                                getCodeBeforeBefore: function() {
                                    var ret = [];

                                    ret.push(DOM_FUNC);
                                    ret.push('.text(');
                                    ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                    ret.push(', ');

                                    return ret.join('');
                                },

                                getCodeAfterAfter: function() {
                                    return ');';
                                }
                            });
                        },

                        '(': function() {
                            // DOM (expr) TEXT (expr2)
                            cmd.getCodeBefore = function() {
                                var ret = [];

                                ret.push(DOM_FUNC);
                                ret.push('.text(');
                                ret.push(cooValueToJS(cmd, cmd.parts[1]));
                                ret.push(', ');
                                ret.push(cooValueToJS(cmd, cmd.parts[3]));
                                ret.push(');');

                                return ret.join('');
                            };
                        }
                    }
                }
            }
        });
    }


    var eventList = {
        CLICK: 'click',
        DBLCLICK: 'dblclick',
        MOUSEDOWN: 'mousedown',
        MOUSEUP: 'mouseup',
        MOUSEOVER: 'mouseover',
        MOUSEMOVE: 'mousemove',
        MOUSEOUT: 'mouseout',
        DRAGSTART: 'dragstart',
        DRAG: 'drag',
        DRAGENTER: 'dragenter',
        DRAGLEAVE: 'dragleave',
        DRAGOVER: 'dragover',
        DROP: 'drop',
        DRAGEND: 'dragend',
        KEYDOWN: 'keydown',
        KEYPRESS: 'keypress',
        KEYUP: 'keyup',
        LOAD: 'load',
        UNLOAD: 'unload',
        ABORT: 'abort',
        ERROR: 'error',
        RESIZE: 'resize',
        SCROLL: 'scroll',
        SELECT: 'select',
        CHANGE: 'change',
        SUBMIT: 'submit',
        RESET: 'reset',
        FOCUS: 'focus',
        BLUR: 'blur',
        FOCUSIN: 'focusin',
        FOCUSOUT: 'focusout'
    };

    var eventPatterns = {

    };

    function getProcessEventFunc(name, hasParam) {
        return function(cmd) {
            // EVENT
            // or
            // EVENT identifier
            cmd.hasSubblock = true;

            cooCreateScope(cmd);

            if (hasParam) {
                cooPushScopeVariable(cmd, cmd.parts[1].value, false);
            }

            cmd.getCodeBefore = function() {
                var ret = [];

                ret.push('.on("');
                ret.push(name);
                ret.push('", function(');

                if (hasParam) {
                    ret.push(cmd.parts[1].value);
                }

                ret.push(') {');

                return ret.join('');
            };

            cmd.getCodeAfter = function() {
                return '})';
            };
        };
    }

    for (var e in eventList) {
        eventPatterns[e] = {
            '@': getProcessEventFunc(eventList[e], false),
            '': getProcessEventFunc(eventList[e], true)
        };
    }

    function domProcessEvents(cmd) {
        return cooMatchCommand(cmd, eventPatterns);
    }


    CooCoo.cmd.DOM = {
        process: domProcess,
        arrange: null,
        base: 'dom'
    };
})();
