(function() {
    /* global cooObjectBase */
    /* global cooGetScopeVariablesDecl */
    /* global COO_COMMAND_PART_STRING */
    /* global COO_COMMAND_PART_JS */
    /* global COO_COMMAND_PART_VARIABLE */
    /* global cooExtractParamNames */
    /* global INDENT */
    /* global cooRunGenerators */
    /* global cooCreateScope */
    /* global cooMatchCommand */
    /* global cooGetParamsDecl */
    /* global cooAssertNotRetPusher */
    /* global cooGetDecl */

    function createRouteMethod(actualName) {
        return {
            actualName: actualName,

            getPatterns: function(callback) {
                return {
                    '#': function() { return callback(); },
                    '($$)': function() { return callback(); }
                };
            },

            extractParams: function(cmd) {
                var params;

                if (cmd.name === 'nomatch') {
                    if (cmd.parts.length > 1) {
                        cmd.file.errorUnexpectedPart(cmd.parts[1]);
                    }

                    if (Object.keys(cmd.root.data.methods).length) {
                        cmd.parts[0].error = 'Either combination of pathname, search and hash or nomatch is possible';
                        cmd.file.errorUnexpectedPart(cmd.parts[0]);
                    }
                } else {
                    if ('nomatch' in cmd.root.data.methods) {
                        cmd.parts[0].error = 'Either nomatch or combination of pathname, search and hash is possible';
                        cmd.file.errorUnexpectedPart(cmd.parts[0]);
                    }
                }

                if (cmd.parts.length > 1) {
                    if (cmd.parts[1].type === COO_COMMAND_PART_STRING ||
                        cmd.parts[1].type === COO_COMMAND_PART_JS)
                    {
                        params = {};
                    } else if (cmd.parts[1].type === COO_COMMAND_PART_VARIABLE) {
                        params = cooExtractParamNames(cmd, cmd.parts, 1);
                    } else {
                        cmd.file.errorUnexpectedPart(cmd.parts[1]);
                    }
                }

                if (cmd.parts.length > 2) {
                    cmd.file.errorUnexpectedPart(cmd.parts[2]);
                }

                return params;
            },

            tuneCommand: function(cmd) {
                cmd.hasSubblock = true;

                if (cmd.parts[1] && cmd.parts[1].type !== COO_COMMAND_PART_VARIABLE) {
                    cmd.hasSubblock = false;
                }

                if (cmd.name === 'nomatch') {
                    cmd.hasSubblock = false;
                }
            },

            getCodeBefore: function(cmd) {
                var tmp;

                if (cmd.name === 'nomatch') {
                    return actualName + ': true' + (cmd.last ? '' : ',');
                } else if (cmd.hasSubblock) {
                    tmp = cooGetScopeVariablesDecl(cmd);

                    if (tmp === '') {
                        cmd.parts[0].error = 'No value';
                        cmd.file.errorUnexpectedPart(cmd.parts[0]);
                    }

                    return actualName + ': function(' + (cmd.parts[1] ? cmd.parts[1].value : '') + ') {' + tmp;
                } else {
                    var ret = [];

                    ret.push(actualName);
                    ret.push(': ');

                    if (cmd.parts[1].type !== COO_COMMAND_PART_JS) {
                        ret.push('new RegExp(');
                    }

                    ret.push(cmd.parts[1].value);

                    if (cmd.parts[1].type !== COO_COMMAND_PART_JS) {
                        ret.push(')');
                    }

                    if (!cmd.last) {
                        ret.push(',');
                    }

                    return ret.join('');
                }
            },

            getCodeAfter: function(cmd) {
                if (cmd.hasSubblock) {
                    var ret;

                    if (cmd.hasRet) {
                        ret = INDENT + 'return CooCoo.u(' + cmd.retName + ');\n';
                    } else {
                        ret = '';
                    }

                    return ret + '}' + (cmd.last ? '' : ',');
                }
            }
        };
    }

    cooObjectBase(
        {
            cmdName: 'route',
            cmdStorage: 'CooCoo.Route',
            instance: true,
            baseClass: {name: 'CooCoo.RouteBase'},
            getCodeAfterAfter: function(cmd) {
                if (!Object.keys(cmd.data.methods).length) {
                    cmd.parts[0].error = 'Route should have at least one of pathname, search, hash or nomatch';
                    cmd.file.errorUnexpectedPart(cmd.parts[0]);
                }
            }
        },
        {
            specialMethods: {
                pathname: createRouteMethod('pathname'),
                search: createRouteMethod('search'),
                hash: createRouteMethod('hash'),
                nomatch: createRouteMethod('nomatch')
            }
        },
        {
            'route': null
        }
    );


    function getBeforeAfterOtherwiseHandler(cmd) {
        // before
        // after
        // otherwise
        //     ...
        cooAssertNotRetPusher(cmd);

        if (cmd.parent['has' + cmd.parts[0].value]) {
            cmd.parts[0].error = 'Duplicate `' + cmd.parts[0].value + '`';
            return cmd.parts[0];
        }

        cmd.parent['has' + cmd.parts[0].value] = cmd;
        cmd.hasSubblock = true;
        cmd.ignore = true;
        cmd.isAsync = true;

        cooCreateScope(cmd);

        cmd.getCodeBefore = function() {
            return 'function() {';
        };

        cmd.getCodeAfter = function() {
            return '}';
        };
    }


    function routeProcessChoices(cmd) {
        return cooMatchCommand(cmd, {
            'route': {
                '': {
                    '($$)': function() {
                        // route identifier ...
                        //     ...
                        cooAssertNotRetPusher(cmd);

                        if (cmd.parent.hasotherwise) {
                            return cmd.parts[0];
                        }

                        cmd.hasSubblock = true;
                        cmd.ignore = true;

                        cmd.parent.data.routes.push(cmd);

                        cooCreateScope(cmd);

                        cmd.isAsync = true;

                        cmd.getCodeBefore = function() {
                            cooGetDecl(cmd);

                            var ret = [],
                                params = cooExtractParamNames(cmd, cmd.parts, 2);

                            ret.push('{r: CooCoo.Route.' + cmd.parts[1].value + ', c: function(');
                            ret.push(cooGetParamsDecl(params));
                            ret.push(') {');

                            return ret.join('');
                        };

                        cmd.getCodeAfter = function() {
                            var ret = [];
                            ret.push('}}');
                            return ret.join('');
                        };
                    }
                }
            },

            'otherwise': getBeforeAfterOtherwiseHandler,
            'before': getBeforeAfterOtherwiseHandler,
            'after': getBeforeAfterOtherwiseHandler
        });
    }


    CooCoo.cmd.routes = {
        process: function(cmd) {
            if (!cmd.parent) {
                return cmd.parts[0];
            }

            var routesFunc = function() {
                // routes [once]
                //     ...
                cooAssertNotRetPusher(cmd);
                cmd.hasSubblock = true;
                cmd.processChild = routeProcessChoices;

                cmd.data.routes = [];

                cmd.getCodeBefore = function() {
                    var ret = [],
                        routes = cmd.data.routes;

                    if (!routes.length) {
                        cmd.parts[0].error = 'No routes';
                        cmd.file.errorUnexpectedPart(cmd.parts[0]);
                    }

                    ret.push('new CooCoo.Routes(this, ');
                    ret.push(cmd.parts[1] ? 'true,' : 'false,');

                    return ret.join('');
                };

                cmd.getCodeAfter = function() {
                    var ret = [],
                        routes = cmd.data.routes,
                        route,
                        i;

                    routes.unshift(cmd.hasotherwise || null);
                    routes.unshift(cmd.hasafter || null);
                    routes.unshift(cmd.hasbefore || null);

                    for (i = 0; i < routes.length; i++) {
                        route = routes[i];

                        if (route) {
                            route.ignore = false;
                            cooRunGenerators(route, ret, 1);
                            route.ignore = true;
                        } else {
                            ret.push(INDENT + 'null');
                        }

                        if (i < routes.length - 1) {
                            ret[ret.length - 1] += ',';
                        }
                    }

                    ret.push(');');

                    return ret.join('\n');
                };
            };

            return cooMatchCommand(cmd, {
                'routes': {
                    '@': routesFunc,
                    'once': routesFunc
                }
            });
        },
        arrange: null
    };
})();
