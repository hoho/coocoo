/*!
 * coo-coo v0.0.0, https://github.com/hoho/coo-coo
 * (c) 2013 Marat Abdullin, MIT license
 */
var fs = require('fs'),
    util = require('./util.js'),
    extend = require('deep-extend');


var INDENT_WITH = ' ',
    INDENT = INDENT_WITH + INDENT_WITH + INDENT_WITH + INDENT_WITH,

    COO_COMMAND_PART_STRING = 'string',
    COO_COMMAND_PART_JS = 'JavaScript',
    COO_COMMAND_PART_IDENTIFIER = 'identifier',
    COO_COMMAND_PART_PROPERTY_GETTER = 'property getter',
    COO_COMMAND_PART_VARIABLE_GETTER = 'variable getter',
    COO_COMMAND_PART_TYPIFICATION = 'typification',

    COO_INTERNAL_VARIABLE_RET = '__ret';


function CooCommand(file, parent, decls) {
    this.debug = file.ret.debug;
    this.file = file;
    this.decls = decls;

    if (parent) {
        this.root = parent.root || parent;
    }

    this.parent = parent;
    this.children = [];
    this.data = {};
}

CooCommand.prototype = {
    root: null,
    valuePusher: false,
    valueRequired: false,
    noScope: false,
    hasSubblock: false,
    hasRet: false,
    parts: null,
    processChild: null,

    indent: 1,
    first: false,
    last: false,

    ignore: false,

    getDeclKey: null,

    getCodeBefore: null,
    getCodeAfter: null
};


function CooCommandPart(type, lineAt, charAt) {
    this.type = type;
    this._lineAt = lineAt;
    this._charAt = charAt;
}

CooCommandPart.prototype = {
    type: null,
    value: null,
    error: null
};


/* exported cooMatchCommand */
function cooMatchCommand(cmd, patterns, pos) {
    var parts = cmd.parts,
        part = parts[(pos = pos || 0)],
        error,
        unexpected = true;

    /*

     `patterns` is an object like:
     {
     something: callback,
     something: {something: callback},
     something: {something: {something: callback}}
     something: ...,
     ...
     }

     Where `something`:
     '' in case of any identifier,
     'Identifier' in case of exact identifier,
     '"' in case of any string,
     '"string"' in case of exact string,
     '(' in case of JavaScript,
     '*' in case of any number of identifiers,
     '#' in case of any number of strings or JavaScripts,
     '<' in case of typification,
     '@' in case of callback.

     And `callback` is a callback to call when pattern is matched.

     */

    if (part) {
        switch (part.type) {
            case COO_COMMAND_PART_STRING:
            case COO_COMMAND_PART_JS:
            case COO_COMMAND_PART_PROPERTY_GETTER:
            case COO_COMMAND_PART_VARIABLE_GETTER:
                if (part.type === COO_COMMAND_PART_STRING) {
                    /* jshint -W061 */
                    var val = JSON.stringify(eval(part.value));
                    /* jshint +W061 */

                    if (patterns[val]) {
                        error = cooMatchCommand(cmd, patterns[val], pos + 1);
                        unexpected = false;
                    }
                }

                if ((error || unexpected) && patterns['(']) {
                    error = cooMatchCommand(cmd, patterns['('], pos + 1);
                    unexpected = false;
                }

                if ((error || unexpected) && patterns['#']) {
                    error = cooMatchCommand(cmd, patterns, pos + 1);
                    unexpected = false;
                }

                if ((error || unexpected) && patterns['#']) {
                    error = cooMatchCommand(cmd, patterns['#'], pos + 1);
                    unexpected = false;
                }

                return unexpected ? part : error;

            case COO_COMMAND_PART_IDENTIFIER:
                if (patterns[part.value]) {
                    error = cooMatchCommand(cmd, patterns[part.value], pos + 1);
                    unexpected = false;
                }

                if ((error || unexpected) && patterns['']) {
                    error = cooMatchCommand(cmd, patterns[''], pos + 1);
                    unexpected = false;
                }

                if ((error || unexpected) && patterns['*']) {
                    error = cooMatchCommand(cmd, patterns, pos + 1);
                    unexpected = false;
                }

                return unexpected ? part : error;

            case COO_COMMAND_PART_TYPIFICATION:
                if (patterns['<']) {
                    error = cooMatchCommand(cmd, patterns['<'], pos + 1);
                    unexpected = false;
                }

                return unexpected ? part : error;

            default:
                cmd.file.errorUnexpectedPart(part);
        }
    } else {
        if (typeof patterns['*'] === 'function') {
            return patterns['*'](cmd);
        } else if (typeof patterns['#'] === 'function') {
            return patterns['#'](cmd);
        } else if (typeof patterns['@'] === 'function') {
            return patterns['@'](cmd);
        } else if (typeof patterns === 'function') {
            return patterns(cmd);
        } else {
            // Incomplete command.
            part = parts[parts.length - 1];
            error = new CooCommandPart(null, part._lineEnd, part._charEnd);
            error.error = 'Incomplete command';
            return error;
        }
    }
}


/* exported cooPushScopeVariable */
function cooPushScopeVariable(cmd, name, value) {
    var tmp = cmd,
        scope = cmd.data.scope;

    while (!scope && tmp.parent) {
        tmp = tmp.parent;
        scope = tmp.data.scope;
    }

    if (!scope) {
        cmd.parts[0].error = 'No variable scope';
        cmd.file.errorUnexpectedPart(cmd.parts[0]);
    }

    scope[name] = value === undefined ? null : value;

    return tmp;
}


function cooCheckScopeVariable(cmd, part) {
    var ok,
        tmp = cmd;

    while (tmp && ok === undefined) {
        if (tmp.data.scope) {
            ok = tmp.data.scope[part.value];
        }
        tmp = tmp.parent;
    }

    if (ok === undefined) {
        part.error = 'Variable is not set yet';
        cmd.file.errorUnexpectedPart(part);
    }
}


/* exported cooCreateScope */
function cooCreateScope(cmd) {
    if (!cmd.data.scope) {
        cmd.data.scope = {};
    }
}


/* exported cooSetScopeRet */
function cooSetScopeRet(cmd) {
    cooPushScopeVariable(cmd, COO_INTERNAL_VARIABLE_RET, 'CooCooRet()').hasRet = true;
}


/* exported cooGetScopeVariablesDecl */
function cooGetScopeVariablesDecl(cmd) {
    var scope = cmd.data.scope,
        scopeVars = [],
        key;

    for (key in scope) {
        if (scope[key] !== false) {
            scopeVars.push(key);
        }
    }

    if (scopeVars.length) {
        key = scopeVars[0];

        var ret = [],
            val = cmd.data.scope[key];

        ret.push('\n' + INDENT + 'var ' + key);

        if (val) {
            ret.push(' = ');
            ret.push(val);
        }

        for (var i = 1; i < scopeVars.length; i++) {
            ret.push(', ' + scopeVars[i]);

            val = cmd.data.scope[scopeVars[i]];
            if (val) {
                ret.push(' = ');
                ret.push(val);
            }
        }

        ret.push(';');

        return ret.join('');
    } else {
        return '';
    }
}


/* exported cooGetScopeRet */
function cooGetScopeRet(cmd) {
    if (cmd.hasRet) {
        return INDENT+ 'return ' + COO_INTERNAL_VARIABLE_RET + ';\n';
    } else {
        return '';
    }
}


/* exported cooGetParamsDecl */
function cooGetParamsDecl(params) {
    var first = true,
        ret = [];

    for (var param in params) {
        if (!first) { ret.push(', '); }
        else { first = false; }

        ret.push(param);
    }

    return ret.join('');
}


function cooGetDecl(cmd, typePart) {
    var name = typePart ? typePart.value[0].value : cmd.parts[0].value,
        decls = cmd.decls[name],
        cls = typePart ? typePart.value[1] : cmd.parts[1],
        decl;

    if (!decls || !((decl = decls[cls.value]))) {
        cls.error = 'Unknown ' + name;
        cmd.file.errorUnexpectedPart(cls);
    }

    return decl;
}


function cooCheckProperty(cmd, decl, part, assert) {
    var prop = decl.data.properties[part.value];

    if (!prop) {
        cmd.file.errorUnknownProperty(part);
    }

    if (cmd.debug && assert && prop.type) {
        var retBefore = [],
            msg,
            typeString;

        // (function(val) { if (!()) { throw new Error("Msg"); }})(expr)

        retBefore.push('(function(val) { if (!(');

        if (prop.type.value[0].type === COO_COMMAND_PART_JS) {
            retBefore.push('CooCooRet(val).valueOf() instanceof ');
            retBefore.push(prop.type.value[0].value);
            typeString = prop.type.value[0].value;
        } else {
            retBefore.push(CooCoo.cmd[prop.type.value[0].value].type.getAssertExpression(cmd, prop.type, 'val'));

            typeString = [];
            for (var i = 0; i < prop.type.value.length; i++) {
                typeString.push(prop.type.value[i].value);
            }
            typeString = typeString.join(' ');
        }

        retBefore.push(')) { throw new Error("');

        msg = cmd.file.getErrorMessage(
            'Not <' + typeString + '>',
            assert._charAt,
            assert._lineAt
        );
        msg = msg.split('\n').join('\\n').replace(/"/g, '\\"');
        retBefore.push(msg);

        retBefore.push('"); } return val; })(');

        return [retBefore.join(''), ')'];
    }
}


/* exported cooValueToJS */
function cooValueToJS(cmd, part) {
    switch (part.type) {
        case COO_COMMAND_PART_JS:
        case COO_COMMAND_PART_STRING:
            return part.value;

        case COO_COMMAND_PART_VARIABLE_GETTER:
            cooCheckScopeVariable(cmd, part);
            return part.value;

        case COO_COMMAND_PART_PROPERTY_GETTER:
            cooCheckProperty(cmd, cmd.root, part);
            return 'this.get("' + part.value + '")';

        default:
            part.error = 'Incorrect type';
            cmd.file.errorUnexpectedPart(part);
    }
}


function CooFile(filename) {
    var data = fs.readFileSync(filename, {encoding: 'utf8'});

    this.filename = filename;
    this.src = data.split(/\n\r|\r\n|\r|\n/);
    this.code = data.split(/\n\r|\r\n|\r|\n/);

    util.cooClearComments(this.code);
}

CooFile.prototype = {
    read: function(ret) {
        var oldRet = this.ret,
            oldLineAt = this.lineAt,
            oldCharAt = this.charAt,
            oldBlockIndent = this.blockIndent;

        this.ret = ret;
        this.lineAt = this.charAt = 0;
        this.blockIndent = 0;

        while (this.skipEmptyLines()) {
            this.readCommand();
        }

        this.ret = oldRet;
        this.lineAt = oldLineAt;
        this.charAt = oldCharAt;
        this.blockIndent = oldBlockIndent;
    },

    skipEmptyLines: function() {
        for (var i = this.lineAt; i < this.code.length; i++) {
            if (this.code[i] !== '') {
                break;
            }
        }

        this.lineAt = i;
        this.charAt = 0;

        return this.lineAt < this.code.length;
    },

    readCommand: function(parent) {
        var i,
            line = this.code[this.lineAt],
            cmd = new CooCommand(this, parent, this.ret.declCmd);

        for (i = 0; i < this.blockIndent; i++) {
            if (line[i] !== INDENT_WITH) {
                this.errorBadIndentation(i);
            }
        }

        i = this.blockIndent;

        if (line[i] === '+') {
            if (!parent || !parent.valueRequired) {
                // Pretty dumb error messages.
                this.error(
                    parent ?
                        '"' + parent.name + '" command does not require return value'
                        :
                        'No place to return value to',
                    i
                );
            } else {
                // This command pushes value to parent one.
                cmd.valuePusher = true;
                i++;
            }
        }

        if (line[i].match(/[a-zA-Z"'(_$@]/)) {
            var parts = cmd.parts = this.readCommandParts(i);

            if (cmd.valuePusher) {
                cooSetScopeRet(cmd);
            }

            if (parts[0].type === COO_COMMAND_PART_STRING ||
                parts[0].type === COO_COMMAND_PART_JS ||
                parts[0].type === COO_COMMAND_PART_VARIABLE_GETTER ||
                parts[0].type === COO_COMMAND_PART_PROPERTY_GETTER)
            {
                // Check for certain conditions in case command begins with
                // a string or with a JavaScript expression.
                if (parent && parent.valueRequired && cmd.valuePusher) {
                    cmd.getCodeBefore = function() {
                        var ret = [];

                        ret.push(COO_INTERNAL_VARIABLE_RET);
                        ret.push('.push(');
                        ret.push(cooValueToJS(cmd, cmd.parts[0]));
                        ret.push(');');

                        return ret.join('');
                    };

                    if (parts.length > 1) { this.errorUnexpectedPart(parts[1]); }

                    this.nextLine();
                } else {
                    this.errorUnexpectedPart(parts[0]);
                }
            } else {
                // Match command and run it's callback.
                var errorPart;

                cmd.name = parts[0].value;

                if (parent && parent.processChild) {
                    errorPart = parent.processChild(cmd);
                } else if (cmd.name === 'JS') {
                    var self = this;

                    errorPart = cooMatchCommand(cmd, {
                        'JS': function() {
                            var val = self.readJS(self.blockIndent);

                            cmd.getCodeBefore = function() {
                                var ret = [];

                                if (cmd.valuePusher) {
                                    ret.push(COO_INTERNAL_VARIABLE_RET);
                                    ret.push('.push(');
                                }

                                ret.push('(function() {\n');
                                ret.push(val.value);

                                return ret.join('');
                            };

                            cmd.getCodeAfter = function() {
                                var ret = [];

                                ret.push('}).call(this)');

                                if (cmd.valuePusher) {
                                    ret.push(')');
                                }

                                ret.push(';');

                                return ret.join('');
                            };
                        }
                    });
                } else {
                    var commandHandlers = CooCoo.cmd[cmd.name];

                    if (commandHandlers.base) {
                        this.ret.base[commandHandlers.base] = true;
                    }

                    if (commandHandlers.arrange) {
                        this.ret.arrange[cmd.name] = commandHandlers.arrange;
                    }

                    if (commandHandlers && commandHandlers.process) {
                        errorPart = commandHandlers.process(cmd);
                    } else {
                        errorPart = parts[0];
                    }
                }

                if (errorPart) {
                    this.errorUnexpectedPart(errorPart);
                }

                if (cmd.hasSubblock) {
                    if (cmd.valueRequired && !cmd.noScope) { cooCreateScope(cmd); }
                    this.readBlock(cmd);

                } else {
                    this.nextLine();
                }
            }

            if (!parent) {
                if (cmd.getDeclKey) {
                    var declKey = cmd.getDeclKey(),
                        decls = this.ret.declCmd[declKey.first];

                    if (!decls) {
                        this.ret.declCmd[declKey.first] = decls = {};
                    }

                    if (declKey.last in decls) {
                        cmd.parts[0].error = 'Redeclaration';
                        this.errorUnexpectedPart(cmd.parts[0]);
                    } else {
                        decls[declKey.last] = cmd;
                    }
                } else {
                    this.ret.cmd.push(cmd);
                }
            } else {
                parent.children.push(cmd);
            }
        } else {
            if (line[i] === INDENT_WITH) { this.errorBadIndentation(i); }
            else { this.errorUnexpectedSymbol(i); }
        }
    },

    readCommandParts: function(charAt) {
        var parts = [];

        this.charAt = charAt;

        while (this.charAt < this.code[this.lineAt].length) {
            switch (this.code[this.lineAt][this.charAt]) {
                case '"':
                /* jshint -W109 */
                case "'":
                /* jshint +W109 */
                    parts.push(this.readString());
                    break;

                case '(':
                    parts.push(this.readJS(0));
                    break;

                case '<':
                    parts.push(this.readTypification());
                    break;

                default:
                    parts.push(this.readIdentifier());
            }
        }

        return parts;
    },

    readString: function() {
        var part = new CooCommandPart(COO_COMMAND_PART_STRING, this.lineAt, this.charAt),
            line = this.code[this.lineAt],
            startPos = this.charAt,
            starter = line[startPos];

        /* jshint -W109 */
        if (starter !== '"' && starter !== "'") {
        /* jshint +W109 */
            this.errorUnexpectedSymbol();
        }

        this.charAt++;

        while (this.charAt < line.length) {
            if (line[this.charAt] === starter && line[this.charAt - 1] !== '\\') {
                break;
            } else {
                this.charAt++;
            }
        }

        if (this.charAt < line.length) {
            part.value = line.substring(startPos, this.charAt + 1);
            this.charAt++;
            part._lineEnd = this.lineAt;
            part._charEnd = this.charAt + 1;
            this.skipWhitespaces();
        } else {
            this.error('Unterminated string', startPos);
        }

        return part;
    },

    readJS: function(indent, noSkipWhitespacesAfter) {
        var part = new CooCommandPart(COO_COMMAND_PART_JS, this.lineAt, this.charAt),
            val = [];

        if (!indent) {
            if (this.code[this.lineAt][this.charAt] !== '(') {
                this.errorUnexpectedSymbol();
            }

            var brackets,
                startLine = this.lineAt,
                startChar = this.charAt,
                inString;

            brackets = 1;
            this.charAt++;

            if ((this.charAt === this.code[this.lineAt].length) && !this.nextLine()) {
                this.error('Unterminated expression', startChar, startLine);
            }

            while (brackets > 0 && (this.charAt < this.code[this.lineAt].length)) {
                if (!inString) {
                    if (this.code[this.lineAt][this.charAt] === '(') {
                        brackets++;
                    } else if (this.code[this.lineAt][this.charAt] === ')') {
                        brackets--;

                        if (brackets === 0) {
                            this.charAt++;
                            break;
                        }
                    /* jshint -W109 */
                    } else if (this.code[this.lineAt][this.charAt] === '"' ||
                               this.code[this.lineAt][this.charAt] === "'")
                    /* jshint +W109 */
                    {
                        inString = this.code[this.lineAt][this.charAt];
                    }
                } else {
                    if (this.code[this.lineAt][this.charAt] === inString &&
                        this.code[this.lineAt][this.charAt - 1] !== '\\')
                    {
                        inString = false;
                    }
                }

                val.push(this.code[this.lineAt][this.charAt]);

                this.charAt++;

                if (this.charAt === this.code[this.lineAt].length) {
                    val.push('\n');

                    if (!this.nextLine()) {
                        this.error('Unterminated expression', startChar, startLine);
                    }
                }
            }

            part._lineEnd = this.lineAt;
            part._charEnd = this.charAt + 1;

            if (!noSkipWhitespacesAfter) {
                this.skipWhitespaces();
            }

            val.unshift('(');
            val.push(')');
        } else {
            while (this.nextLine() && this.getIndent() > indent) {
                val.push(this.code[this.lineAt].substring(indent));
            }

            this.lineAt--;
            this.charAt = this.code[this.lineAt].length;

            part._lineEnd = this.lineAt;
            part._charEnd = this.charAt;
        }

        part.value = val.join(indent ? '\n' : '');

        return part;
    },

    readIdentifier: function(noGetters, terminal) {
        var part,
            type,
            line = this.code[this.lineAt],
            val,
            nextChar = 0;

        switch (line[this.charAt]) {
            /* jshint -W086 */
            case '@':
                if (!noGetters) {
                    type = COO_COMMAND_PART_PROPERTY_GETTER;
                    nextChar = 1;
                    break;
                }
            case '$':
                if (!noGetters) {
                    type = COO_COMMAND_PART_VARIABLE_GETTER;
                    nextChar = 1;
                    break;
                }
            default:
                type = COO_COMMAND_PART_IDENTIFIER;
            /* jshint +W086 */
        }

        val = [];
        part = new CooCommandPart(type, this.lineAt, this.charAt);
        this.charAt += nextChar;

        if (line[this.charAt].match(/[a-zA-Z_]/)) {
            val.push(line[this.charAt]);
            this.charAt++;
        } else {
            this.errorUnexpectedSymbol();
        }

        while (this.charAt < line.length && line[this.charAt].match(/[a-zA-Z0-9_]/)) {
            val.push(line[this.charAt]);
            this.charAt++;
        }

        if (!terminal || line[this.charAt] !== terminal) {
            part._lineEnd = this.lineAt;
            part._charEnd = this.charAt + 1;
            this.skipWhitespaces();
        }

        if (val.length) {
            part.value = val.join('');
        } else {
            part.error = 'Incomplete ' + type;
            this.errorUnexpectedPart(part);
        }

        return part;
    },

    readTypification: function() {
        var part = new CooCommandPart(COO_COMMAND_PART_TYPIFICATION, this.lineAt, this.charAt),
            val = [];

        part.value = val;

        if (this.code[this.lineAt][this.charAt] !== '<') {
            this.errorUnexpectedSymbol();
        }

        this.charAt++;
        this.skipWhitespaces(true);

        switch (this.code[this.lineAt][this.charAt]) {
            case '>':
                this.errorUnexpectedSymbol();
                break;

            case '(':
                val.push(this.readJS(0, true));
                break;

            default:
                var line = this.code[this.lineAt];

                while (this.charAt < line.length && line[this.charAt] !== '>') {
                    val.push(this.readIdentifier(true, '>'));
                }

                if (val[0]) {
                    var handlers = CooCoo.cmd[val[0].value];
                    if (handlers && handlers.type) {
                        handlers.type.validate(this, part);
                    } else {
                        this.errorUnexpectedPart(val[0]);
                    }
                }
        }

        this.skipWhitespaces(true);

        if (this.code[this.lineAt][this.charAt] !== '>') {
            this.errorUnexpectedSymbol();
        }

        this.charAt++;
        this.skipWhitespaces();

        return part;
    },

    readBlock: function(parent) {
        if (!this.nextLine()) {
            return false;
        }

        var oldIndent = this.blockIndent,
            indent,
            curIndent;

        indent = this.getIndent();

        if (indent > oldIndent) {
            this.blockIndent = indent;

            curIndent = indent;

            while (curIndent === indent) {
                this.readCommand(parent);
                curIndent = this.getIndent();
            }

            this.blockIndent = oldIndent;
        }
    },

    nextLine: function() {
        this.lineAt++;
        this.charAt = 0;

        return this.skipEmptyLines();
    },

    getIndent: function() {
        var indent = 0;

        if (this.lineAt < this.code.length) {
            while (this.code[this.lineAt][indent] === INDENT_WITH) {
                indent++;
            }
        }

        return indent;
    },

    skipWhitespaces: function(noException) {
        var line = this.code[this.lineAt],
            whitespace = /[\x20\t\r\n\f]/;

        if (!noException && (this.charAt < line.length && !line[this.charAt].match(whitespace))) {
            this.errorUnexpectedSymbol();
        }

        while (this.charAt < line.length && line[this.charAt].match(whitespace)) {
            this.charAt++;
        }
    },

    getErrorMessage: function(msg, charAt, lineAt) {
        var line = (lineAt === undefined ? this.lineAt : lineAt) + 1,
            col = charAt + 1;

        return this.filename + ': ' + msg + ' (line: ' + line + ', col: ' + col + '):\n' +
               this.src[line - 1] + '\n' + (new Array(col).join(' ')) + '^\n';
    },

    error: function(msg, charAt, lineAt) {
        throw new Error(this.getErrorMessage(msg, charAt, lineAt));
    },

    errorBadIndentation: function(charAt) {
        this.error('Bad indentation', charAt);
    },

    errorUnexpectedSymbol: function(charAt) {
        this.error('Unexpected symbol', charAt === undefined ? this.charAt : charAt);
    },

    errorUnexpectedPart: function(part) {
        this.error(part.error || ('Unexpected ' + part.type), part._charAt, part._lineAt);
    },

    errorUnknownProperty: function(part) {
        this.error('Unknown property', part._charAt, part._lineAt);
    },

    errorUnknownMethod: function(part) {
        this.error('Unknown method', part._charAt, part._lineAt);
    },

    errorNoValue: function(part) {
        this.error('Command returns no value', part._charAt, part._lineAt);
    },

    errorMeaninglessValue: function(part) {
        this.error('Command returns meaningless value', part._charAt, part._lineAt);
    },

    errorMeaninglessCommand: function(part) {
        this.error('Command has no meaning', part._charAt, part._lineAt);
    },

    errorUndeclared: function(part) {
        this.error('Dependency is not declared', part._charAt, part._lineAt);
    }
};


/* exported cooAssertNotValuePusher */
function cooAssertNotValuePusher(cmd) {
    if (cmd.valuePusher) {
        cmd.file.errorNoValue(cmd.parts[0]);
    }
}


/* exported cooAssertValuePusher */
function cooAssertValuePusher(cmd) {
    if (!cmd.valuePusher) {
        cmd.file.errorMeaninglessValue(cmd.parts[0]);
    }
}


/* exported cooAssertHasSubcommands */
function cooAssertHasSubcommands(cmd) {
    if (!cmd.children.length) {
        cmd.file.errorMeaninglessCommand(cmd.parts[0]);
    }
}


function cooRunGenerators(cmd, code, level) {
    if (cmd.ignore) {
        return;
    }

    var c = cmd.children,
        i,
        indent = (new Array(level + 1)).join(INDENT);

    if (cmd.getCodeBefore && (i = cmd.getCodeBefore())) {
        code.push(indent + i.split('\n').join('\n' + indent));
    }

    if (c) {
        var last,
            first = true,
            subcmd;

        for (i = 0; i < c.length; i++) {
            subcmd = c[i];

            if (subcmd.getCodeBefore || subcmd.getCodeAfter) {
                if (first) {
                    subcmd.first = true;
                    first = false;
                }

                last = subcmd;
            }
        }

        if (last) {
            last.last = true;
        }

        for (i = 0; i < c.length; i++) {
            subcmd = c[i];
            cooRunGenerators(subcmd, code, level + subcmd.indent);
        }
    }

    if (cmd.getCodeAfter && (i = cmd.getCodeAfter())) {
        code.push(indent + i.split('\n').join('\n' + indent));
    }
}


function CooCoo(filenames, commons, project, debug) {
    CooCoo.decl = {};

    var ret = {
        debug: debug,
        base: {core: true},
        arrange: {},
        declCmd: {},
        cmd: []
    };

    var i,
        file,
        tmp,
        code = [];

    for (i = 0; i < filenames.length; i++) {
        file = new CooFile(filenames[i]);
        file.read(ret);
    }

    tmp = ret.arrange;
    for (i in tmp) {
        tmp[i](ret.declCmd, ret.cmd);
    }

    // Super dump vay to put collections at the bottom (they depend on models).
    // XXX: Implement this thing in arrange function.
    tmp = ret.cmd.filter(function(item) { return item.name !== 'COLLECTION'; });
    cooRunGenerators({children: tmp}, code, 0);

    tmp = ret.cmd.filter(function(item) { return item.name === 'COLLECTION'; });
    cooRunGenerators({children: tmp}, code, 0);

    tmp = [];
    for (i in ret.base) {
        file = __dirname + '/' + i + '_.js';
        tmp.push('// ' + file);
        tmp.push(fs.readFileSync(file, {encoding: 'utf8'}));
        tmp.push('');
        tmp.push('');
    }

    fs.writeFileSync(commons, tmp.join('\n'));

    code.unshift('(function(CooCoo, CooCooRet) {');
    code.push('})(CooCoo, CooCooRet);\n');
    fs.writeFileSync(project, code.join('\n'));
}


/* exported cooExtractParamNames */
function cooExtractParamNames(cmd, parts, start) {
    var params = {},
        i,
        part;

    for (i = start; i < parts.length; i++) {
        part = parts[i];

        if (part.type !== COO_COMMAND_PART_IDENTIFIER) {
            cmd.file.errorUnexpectedPart(part);
        }

        if (part.value in params) {
            part.error = 'Duplicate parameter';
            cmd.file.errorUnexpectedPart(part);
        }

        params[part.value] = true;
    }

    return params;
}


/* exported cooExtractParamValues */
function cooExtractParamValues(cmd, start) {
    var values = [],
        i,
        parts = cmd.parts,
        part;

    for (i = start; i < parts.length; i++) {
        part = parts[i];

        if (part.type === COO_COMMAND_PART_IDENTIFIER) {
            cmd.file.errorUnexpectedPart(part);
        }

        values.push(cooValueToJS(cmd, part));
    }

    return values;
}


/* exported cooProcessBlockAsValue */
function cooProcessBlockAsValue(cmd, ext) {
    cmd.hasSubblock = true;
    cmd.valueRequired = true;

    cooCreateScope(cmd);

    cmd.getCodeBefore = function() {
        var ret = [],
            tmp;

        if (ext.getCodeBeforeBefore && (tmp = ext.getCodeBeforeBefore(cmd))) {
            ret.push(tmp);
        }

        ret.push('(function() {');
        ret.push(cooGetScopeVariablesDecl(cmd));

        if (ext.getCodeBeforeAfter && (tmp = ext.getCodeBeforeAfter(cmd))) {
            ret.push(tmp);
        }

        return ret.join('');
    };

    cmd.getCodeAfter = function() {
        var ret = [],
            tmp;

        if (ext.getCodeAfterBefore && (tmp = ext.getCodeAfterBefore(cmd))) {
            ret.push(tmp);
        }

        tmp = cooGetScopeRet(cmd);

        if (tmp) {
            ret.push(tmp);
        } else {
            cmd.file.errorNoValue(cmd.parts[0]);
        }

        ret.push('}).call(this)');

        if (ext.getCodeAfterAfter && (tmp = ext.getCodeAfterAfter(cmd))) {
            ret.push(tmp);
        }

        return ret.join('');
    };
}


/* exported cooProcessParam */
function cooProcessParam(cmd, hasValue) {
    var elemParams = cmd.parent.data.elemParams;

    if (!elemParams) { elemParams = cmd.parent.data.elemParams = {}; }

    var name = cmd.parts[1];

    if (name.value in elemParams) {
        name.error = 'Duplicate parameter';
        cmd.file.errorUnexpectedPart(name);
    }

    elemParams[name.value] = cmd;

    if (hasValue) {
        cmd.getCodeBefore = function() {
            cmd.ignore = true;
            return cooValueToJS(cmd, cmd.parts[2]);
        };
    } else {
        return cooProcessBlockAsValue(cmd, {
            getCodeBeforeBefore: function() {
                cmd.ignore = true;
            }
        });
    }
}


/* exported cooGetParamValues */
function cooGetParamValues(cmd, names, paramsArray, elemParams) {
    var param;

    if (paramsArray.length > 0 && elemParams) {
        param = elemParams[Object.keys(elemParams)[0]];
        param.parts[0].error = 'Can\'t mix PARAM commands with inline params';
        param.file.errorUnexpectedPart(param.parts[0]);
    }

    if (paramsArray.length) {
        return paramsArray.join(', ');
    } else if (elemParams) {
        var ret = [];

        for (param in elemParams) {
            if (!(param in names)) {
                param = elemParams[param];
                param.parts[1].error = 'Unknown parameter';
                param.file.errorUnexpectedPart(param.parts[1]);
            }
        }

        names = Object.keys(names);

        if (names.length) {
            ret.push('');
        }

        for (var i = 0; i < names.length; i++) {
            param = elemParams[names[i]];

            if (param) {
                cooRunGenerators(param, ret, 1);
            } else {
                ret.push(INDENT + 'undefined');
            }

            if (i < names.length - 1) {
                ret[ret.length - 1] += ',';
            }
        }

        ret.push('');

        return ret.join('\n');
    }
}


/* exported cooObjectBase */
function cooObjectBase(cmdName, cmdStorage, baseClass, declExt, commandExt, subCommandExt) {
    /*
    `cmdStorage` is a place for this class to be stored: CooCoo[cmdStorage][name].

    `baseClass` is an object like:
        {
            name: 'CooCoo.ViewBase',
            methods: {init: true, destroy: true, render: true}
        }

    `declExt` is an object like:
        {
            specialProperties: {
                prop: {
                    actualName: name,
                    default: value,
                    required: true

                    tuneCommand: func,
                    getCodeBeforeBefore: func,
                    getCodeBefore: func, // override.
                    getCodeBeforeAfter: func,
                    getCodeAfterBefore: func,
                    getCodeAfter: func, // override.
                    getCodeAfterAfter: func
                },
                ...
            },
            specialMethods: {
                method: {
                    actualName: name,
                    required: true,
                    noValue: true,

                    tuneCommand: func,
                    getCodeBeforeBefore: func,
                    getCodeBefore: func, // override.
                    getCodeBeforeAfter: func,
                    getCodeAfterBefore: func,
                    getCodeAfter: func, // override.
                    getCodeAfterAfter: func
                },
                ...
            },
            init: true,
            destroy: true,
            properties: true, // allow custom properties.
            methods: true, // allow custom methods.
        }

    `commandExt` and `subCommandExt` is an extension for default
    cooMatchCommand() object.
    */


    function cmdProcess(cmd) {
        if (cmd.parent) {
            return cmdProcessCommand(cmd);
        } else {
            var patterns = {},
                error,
                exts;

            patterns[cmdName] = {
                '': {
                    '@': function() {
                        // `NAME` identifier
                    },

                    'EXTENDS': {
                        '': function() {
                            // `NAME` identifier EXTENDS identifier2
                            exts = cmd.parts[3].value;
                        }
                    }
                }
            };

            error = cooMatchCommand(cmd, patterns);

            if (error) {
                return error;
            }

            cmd.getDeclKey = function() {
                return {first: cmd.parts[0].value, last: cmd.parts[1].value};
            };

            // Template declaration.
            cmd.hasSubblock = true;
            cmd.processChild = cmdProcessDecl;

            cmd.data = {
                name: cmd.parts[1].value,
                exts: exts,
                construct: null,
                destruct: null,
                properties: {},
                methods: {},
                storage: cmdStorage
            };

            cmd.getCodeBefore = function() {
                var ret = [cmdStorage + '.' + cmd.parts[1].value + ' = '];

                if (exts) {
                    ret.push(cmdStorage + '.' + exts);
                } else {
                    ret.push(baseClass.name);
                }

                // .extend({
                ret.push('.extend({');

                if (cmd.debug) {
                    ret.push('\n');
                    ret.push(INDENT);
                    ret.push('__what: "');
                    ret.push(cmdStorage);
                    ret.push('.');
                    ret.push(cmd.parts[1].value);
                    ret.push('",');
                }

                return ret.join('');
            };

            cmd.getCodeAfter = function() {
                return '});' + (cmd.last ? '' : '\n');
            };
        }
    }


    function cmdProcessDecl(cmd) {
        function processProperty(typeval, special, specialData) {
            var props = cmd.parent.data.properties,
                part = cmd.parts[special ? 0 : 1],
                propName = special ? specialData.actualName : part.value;

            if (propName in props) {
                part.error = 'Duplicate property';
                return part;
            }

            part = typeval.value;

            if (part) {
                if (part.type === COO_COMMAND_PART_PROPERTY_GETTER ||
                    part.type === COO_COMMAND_PART_VARIABLE_GETTER)
                {
                    part.error = 'Unexpected ' + part.type;
                    return part;
                }
            } else {
                cmd.hasSubblock = true;
                cmd.valueRequired = true;
                cooCreateScope(cmd);
            }

            props[propName] = typeval;

            if (specialData && specialData.tuneCommand) {
                var error = specialData.tuneCommand(cmd);
                if (error) { return error; }
            }

            cmd.getCodeBefore = function() {
                var ret = [];

                if (specialData && specialData.getCodeBeforeBefore) {
                    ret.push(specialData.getCodeBeforeBefore(cmd));
                }

                if (specialData && specialData.getCodeBefore) {
                    ret.push(specialData.getCodeBefore(cmd));
                } else {
                    if (typeval.value) {
                        ret.push(propName + ': ' + cooValueToJS(cmd, typeval.value) + (cmd.last ? '' : ',\n'));
                    } else {
                        if (cmd.children.length) {
                            ret.push(propName + ': (function() {' + cooGetScopeVariablesDecl(cmd));
                        }
                    }
                }

                if (specialData && specialData.getCodeBeforeAfter) {
                    ret.push(specialData.getCodeBeforeAfter(cmd));
                }

                return ret.join('\n');
            };

            cmd.getCodeAfter = function() {
                var ret = [];

                if (specialData && specialData.getCodeAfterBefore) {
                    ret.push(specialData.getCodeAfterBefore(cmd));
                }

                if (specialData && specialData.getCodeAfter) {
                    ret.push(specialData.getCodeAfter(cmd));
                } else {
                    if (!typeval.value && cmd.children.length) {
                        ret.push(cooGetScopeRet(cmd) + '})()' + (cmd.last ? '' : ',\n'));
                    }
                }

                if (specialData && specialData.getCodeAfterAfter) {
                    ret.push(specialData.getCodeAfterAfter(cmd));
                }

                return ret.join('\n');
            };
        }


        function processMethod(special, specialData) {
            var methods = cmd.parent.data.methods,
                part = cmd.parts[special ? 0 : 1],
                methodName = special ? specialData.actualName : part.value;

            if (methodName in methods) {
                part.error = 'Duplicate method';
                return part;
            }

            if (methodName === '__construct' && cmd.parts.length > 2) {
                cmd.parts[2].error = 'Constructor expects only one parameter';
                cmd.file.errorUnexpectedPart(cmd.parts[2]);
            }

            cmd.hasSubblock = true;
            cmd.valueRequired = specialData ? !specialData.noValue : true;

            cmd.data.actualName = methodName;

            cooCreateScope(cmd);

            var params = cooExtractParamNames(cmd, cmd.parts, special ? 1 : 2);

            for (var p in params) {
                cooPushScopeVariable(cmd, p, false);
            }

            methods[methodName] = params;

            if (specialData && specialData.tuneCommand) {
                var error = specialData.tuneCommand(cmd);
                if (error) { return error; }
            }

            cmd.getCodeBefore = function() {
                var ret = [];

                if (specialData && specialData.getCodeBeforeBefore) {
                    ret.push(specialData.getCodeBeforeBefore(cmd));
                }

                if (specialData && specialData.getCodeBefore) {
                    ret.push(specialData.getCodeBefore(cmd));
                } else {
                    var ret2 = [];

                    ret2.push(methodName);
                    ret2.push(': function(');

                    ret2.push(cooGetParamsDecl(params));

                    ret2.push(') {');

                    ret2.push(cooGetScopeVariablesDecl(cmd));

                    ret.push(ret2.join(''));
                }

                if (specialData && specialData.getCodeBeforeAfter) {
                    ret.push(specialData.getCodeBeforeAfter(cmd));
                }

                return ret.join('\n');
            };

            cmd.getCodeAfter = function() {
                var ret = [];

                if (specialData && specialData.getCodeAfterBefore) {
                    ret.push(specialData.getCodeAfterBefore(cmd));
                }

                if (specialData && specialData.getCodeAfter) {
                    ret.push(specialData.getCodeAfter(cmd));
                } else {
                    var ret2 = [],
                        tmp = cooGetScopeRet(cmd);

                    if (tmp) {
                        ret2.push(tmp);
                    }

                    ret2.push('}');

                    if (!cmd.last) {
                        ret2.push(',\n');
                    }

                    ret.push(ret2.join(''));
                }

                if (specialData && specialData.getCodeAfterAfter) {
                    ret.push(specialData.getCodeAfterAfter(cmd));
                }

                return ret.join('\n');
            };
        }

        var patterns = {},
            tmp,
            key;

        if (declExt) {
            if (declExt.init) {
                patterns.CONSTRUCT = {
                    '*': function() {
                        return processMethod('CONSTRUCT', {
                            actualName: '__construct',
                            required: false,
                            noValue: true
                        });
                    }
                };
            }

            if (declExt.destroy) {
                patterns.DESTRUCT = function() {
                    return processMethod('DESTRUCT', {
                        actualName: '__destruct',
                        required: false,
                        noValue: true
                    });
                };
            }

            if ((tmp = declExt.specialProperties)) {
                for (key in tmp) {
                    (function(special, specialData) {
                        patterns[special] = {
                            '@': function() {
                                return processProperty({}, special, specialData);
                            }
                        };

                        patterns[special]['('] = function() {
                            return processProperty({value: cmd.parts[1]}, special, specialData);
                        };
                    })(key, tmp[key]);
                }
            }

            if ((tmp = declExt.specialMethods)) {
                for (key in tmp) {
                    (function(special, specialData) {
                        patterns[special] = {
                            '*': function() {
                                return processMethod(special, specialData);
                            }
                        };
                    })(key, tmp[key]);
                }
            }

            if (declExt.properties) {
                patterns.PROPERTY = {
                    '': {
                        '@': function() {
                            return processProperty({});
                        },

                        '(': function() {
                            return processProperty({value: cmd.parts[2]});
                        },

                        '<': {
                            '@': function() {
                                return processProperty({type: cmd.parts[2]});
                            },

                            '(': function() {
                                return processProperty({type: cmd.parts[2], value: cmd.parts[3]});
                            }
                        }
                    }
                };
            }

            if (declExt.methods) {
                patterns.METHOD = {
                    '*': function() {
                        return processMethod();
                    }
                };
            }
        }

        return cooMatchCommand(cmd, patterns);
    }


    function cmdProcessCreateCommand(cmd) {
        cmd.getCodeBefore = function() {
            var cls = cmd.parts[1],
                decl = cooGetDecl(cmd);

            var ret = [];

            if (cmd.valuePusher) {
                ret.push(COO_INTERNAL_VARIABLE_RET);
                ret.push('.push((');
            }

            ret.push('new ');
            ret.push(decl.data.storage);
            ret.push('.');
            ret.push(cls.value);
            ret.push('(this');

            var tmp = cooGetParamValues(cmd, decl.data.methods.__construct, cmd.data.params, cmd.data.elemParams);
            if (tmp) {
                ret.push(', ');
                ret.push(tmp);
            }

            ret.push(')');

            if (cmd.valuePusher) {
                ret.push(')');
            }

            if (!cmd.children.length) {
                ret.push(cmd.valuePusher ? ');' : ';');
            }

            return ret.join('');
        };

        cmd.getCodeAfter = function() {
            if (cmd.children.length) {
                return cmd.valuePusher ? ');' : ';';
            }
        };
    }


    function cmdCheckContext(cmd) {
        if (cmd.root.name !== cmd.name) {
            cmd.parts[0].error = 'Not inside ' + cmd.name;
            cmd.file.errorUnexpectedPart(cmd.parts[0]);
        }
    }


    function cmdProcessCommand(cmd) {
        var pattern = {};

        pattern[cmdName] = {
            '': {
                'CREATE': {
                    '#': function() {
                        // `NAME` identifier CREATE (expr1) (expr2) ...
                        //     ...
                        cmd.hasSubblock = true;

                        if (cmd.parts.length > 4) {
                            // Limit constructor to one parameter to avoid
                            // .apply() and arguments copying in base .init().
                            cmd.parts[4].error = 'Constructor expects only one parameter';
                            cmd.file.errorUnexpectedPart(cmd.parts[4]);
                        }

                        cmd.data.params = cooExtractParamValues(cmd, 3);

                        cmd.processChild = cmdProcessParamsAndEvents;

                        cmdProcessCreateCommand(cmd);
                    }
                },

                '(': {
                    '@': function() {
                        // `NAME` identifier (expr)
                        //     ...

                        cmd.hasSubblock = true;
                        cmd.processChild = cmdProcessEvents;

                        cmd.getCodeBefore = function() {
                            var ret = [],
                                decl = cooGetDecl(cmd);

                            cooAssertHasSubcommands(cmd);

                            ret.push(cooValueToJS(cmd, cmd.parts[2]));

                            if (cmd.debug) {
                                ret.push('\n');
                                ret.push(INDENT);
                                ret.push('.assert(');
                                ret.push(cmdStorage);
                                ret.push('.');
                                ret.push(decl.data.name);
                                ret.push(', "');

                                var msg = cmd.file.getErrorMessage(
                                    'Not instance of ' + cmdStorage + '.' + decl.data.name,
                                    cmd.parts[2]._charAt,
                                    cmd.parts[2]._lineAt
                                );
                                msg = msg.split('\n').join('\\n').replace(/"/g, '\\"');
                                ret.push(msg);

                                ret.push('")');
                            }

                            return ret.join('');
                        };

                        cmd.getCodeAfter = function() {
                            if (cmd.children.length) {
                                return ';';
                            }
                        };
                    },

                    'SET': {
                        '@': function() {
                            // `NAME` identifier (something) SET
                            //     ...
                        },

                        '(': function() {
                            // `NAME` identifier (something) SET (expr)
                        },

                        '': {
                            '@': function() {
                                // `NAME` identifier (something) SET identifier

                                cmd.hasSubblock = true;
                                cmd.valueRequired = true;
                            },

                            '(': function() {
                                // `NAME` identifier (something) SET identifier (expr)
                                cooAssertNotValuePusher(cmd);

                                cmd.getCodeBefore = function() {
                                    var decl = cooGetDecl(cmd),
                                        ret = [],
                                        assert = cooCheckProperty(cmd, decl, cmd.parts[4], cmd.parts[5]);

                                    ret.push(cooValueToJS(cmd, cmd.parts[2]));
                                    ret.push('.set("');
                                    ret.push(cmd.parts[4].value);
                                    ret.push('", ');
                                    if (assert) { ret.push(assert[0]); }
                                    ret.push(cooValueToJS(cmd, cmd.parts[5]));
                                    if (assert) { ret.push(assert[1]); }
                                    ret.push(');');

                                    return ret.join('');
                                };
                            }
                        }
                    },

                    'GET': {
                        '@': function() {
                            // `NAME` identifier (something) GET
                            cooAssertValuePusher(cmd);

                            cmd.getCodeBefore = function() {
                                cooGetDecl(cmd);

                                var ret = [];

                                ret.push(COO_INTERNAL_VARIABLE_RET);
                                ret.push('.push(');
                                ret.push(cooValueToJS(cmd, cmd.parts[2]));
                                ret.push('.get());');

                                return ret.join('');
                            };
                        },

                        '': function() {
                            // `NAME` identifier (something) GET identifier
                            cooAssertValuePusher(cmd);

                            cmd.getCodeBefore = function() {
                                var decl = cooGetDecl(cmd),
                                    ret = [];

                                cooCheckProperty(cmd, decl, cmd.parts[4]);

                                ret.push(COO_INTERNAL_VARIABLE_RET);
                                ret.push('.push(');
                                ret.push(cooValueToJS(cmd, cmd.parts[2]));
                                ret.push('.get("');
                                ret.push(cmd.parts[4].value);
                                ret.push('"));');

                                return ret.join('');
                            };
                        }
                    },

                    'CALL': {
                        '': {
                            '@': function() {
                                // `NAME` identifier (something) CALL identifier
                                //     ...
                                cmd.hasSubblock = true;
                                cmd.valueRequired = true;

                                cmd.processChild = cmdProcessParams;
                            },

                            '#': function() {
                                // `NAME` identifier (something) CALL identifier (expr) (expr) ...
                                var params = cooExtractParamValues(cmd, 5);

                                cmd.getCodeBefore = function() {
                                    var decl = cooGetDecl(cmd);

                                    if (!(cmd.parts[4].value in decl.data.methods)) {
                                        cmd.file.errorUnknownMethod(cmd.parts[4]);
                                    }

                                    var ret = [];

                                    if (cmd.valuePusher) {
                                        ret.push(COO_INTERNAL_VARIABLE_RET);
                                        ret.push('.push(');
                                    }

                                    ret.push(cooValueToJS(cmd, cmd.parts[2]));
                                    ret.push('.');
                                    ret.push(cmd.parts[4].value);
                                    ret.push('(');
                                    ret.push(params.join(', '));

                                    if (cmd.valuePusher) {
                                        ret.push(')');
                                    }

                                    ret.push(');');

                                    return ret.join('');
                                };
                            }
                        }
                    },

                    'DESTROY': function() {
                        // `NAME` identifier (something) DESTROY
                        cooAssertNotValuePusher(cmd);

                        cmd.getCodeBefore = function() {
                            cooGetDecl(cmd);

                            var ret = [];

                            ret.push(cooValueToJS(cmd, cmd.parts[2]));
                            ret.push('.destroy();');

                            return ret.join('');
                        };
                    }
                }
            },

            'SET': {
                '@': function() {
                    // `NAME` SET
                    //     ...
                    cmdCheckContext(cmd);
                    cooAssertNotValuePusher(cmd);

                    return cooProcessBlockAsValue(cmd, {
                        getCodeBeforeBefore: function() {
                            return 'this.set(';
                        },

                        getCodeAfterAfter: function() {
                            return ');';
                        }
                    });
                },

                '(': function() {
                    // `NAME` SET (expr)
                    cmdCheckContext(cmd);
                    cooAssertNotValuePusher(cmd);
                },

                '': {
                    '@': function() {
                        // `NAME` SET identifier
                        //     ...
                        cmdCheckContext(cmd);
                        cooAssertNotValuePusher(cmd);

                        return cooProcessBlockAsValue(cmd, {
                            getCodeBeforeBefore: function() {
                                cooAssertHasSubcommands(cmd);

                                var assert = cooCheckProperty(cmd, cmd.root, cmd.parts[2], cmd.children[0].parts[0]),
                                    ret = [];

                                ret.push('this.set("');
                                ret.push(cmd.parts[2].value);
                                ret.push('", ');
                                if (assert) {
                                    ret.push(assert[0]);
                                    cmd.assertAfter = assert[1];
                                }

                                return ret.join('');
                            },

                            getCodeAfterAfter: function() {
                                var ret = [];

                                if (cmd.assertAfter) { ret.push(cmd.assertAfter); }

                                ret.push(');');

                                return ret.join('');
                            }
                        });
                    },

                    '(': function() {
                        // `NAME` SET identifier (expr)
                        cmdCheckContext(cmd);
                        cooAssertNotValuePusher(cmd);

                        cmd.getCodeBefore = function() {
                            var assert = cooCheckProperty(cmd, cmd.root, cmd.parts[2], cmd.parts[3]),
                                ret = [];

                            ret.push('this.set("');
                            ret.push(cmd.parts[2].value);
                            ret.push('", ');
                            if (assert) { ret.push(assert[0]); }
                            ret.push(cooValueToJS(cmd, cmd.parts[3]));
                            if (assert) { ret.push(assert[1]); }
                            ret.push(');');

                            return ret.join('');
                        };
                    }
                }
            },

            'GET': {
                '@': function() {
                    // `NAME` GET
                    cmdCheckContext(cmd);
                    cooAssertValuePusher(cmd);

                    cmd.getCodeBefore = function() {
                        var ret = [];

                        ret.push(COO_INTERNAL_VARIABLE_RET);
                        ret.push('.push(this.get());');

                        return ret.join('');
                    };
                },

                '': function() {
                    // `NAME` GET identifier
                    cmdCheckContext(cmd);
                    cooAssertValuePusher(cmd);

                    cmd.getCodeBefore = function() {
                        cooCheckProperty(cmd, cmd.root, cmd.parts[2]);

                        var ret = [];

                        ret.push(COO_INTERNAL_VARIABLE_RET);
                        ret.push('.push(this.get("');
                        ret.push(cmd.parts[2].value);
                        ret.push('"));');

                        return ret.join('');
                    };
                }
            },

            'CALL': {
                '': {
                    '@': function() {
                        // `NAME` CALL identifier
                        cmdCheckContext(cmd);

                        cmd.hasSubblock = true;
                        cmd.valueRequired = true;

                        cmd.processChild = cmdProcessParams;
                    },

                    '#': function() {
                        // `NAME` CALL identifier (expr) (expr) ...
                        cmdCheckContext(cmd);

                        var params = cooExtractParamValues(cmd, 3);

                        cmd.getCodeBefore = function() {
                            if (!(cmd.parts[2].value in cmd.root.data.methods)) {
                                cmd.file.errorUnknownMethod(cmd.parts[2]);
                            }

                            var ret = [];

                            if (cmd.valuePusher) {
                                ret.push(COO_INTERNAL_VARIABLE_RET);
                                ret.push('.push(');
                            }

                            ret.push('this.');
                            ret.push(cmd.parts[2].value);
                            ret.push('(');
                            ret.push(params.join(', '));

                            if (cmd.valuePusher) {
                                ret.push(')');
                            }

                            ret.push(');');

                            return ret.join('');
                        };
                    }
                }
            },

            'DESTROY': function() {
                // `NAME` DESTROY
                cmdCheckContext(cmd);
                cooAssertNotValuePusher(cmd);

                cmd.getCodeBefore = function() {
                    return 'this.destroy();';
                };
            }
        };

        return cooMatchCommand(cmd, extend(pattern, commandExt));
    }


    function cmdProcessEvent(cmd, hasName, hasParams) {
        cmd.hasSubblock = true;

        cooCreateScope(cmd);

        var params,
            tmp;

        if (hasParams) {
            params = hasName ? {'_': true} : {};

            tmp = cooExtractParamNames(cmd, cmd.parts, hasParams);

            for (var param in tmp) {
                cooPushScopeVariable(cmd, param, false);
            }

            params = extend(params, tmp);
        }

        cmd.getCodeBefore = function() {
            var ret = [];

            ret.push('.on("');
            ret.push(cmd.parts[0].value.toLowerCase());

            if (hasName) {
                var name = cmd.parts[1];
                ret.push(':');

                if (name.type === COO_COMMAND_PART_STRING) {
                    ret.push(name.value.substring(1));
                } else {
                    ret.push('" + ');
                    ret.push(cooValueToJS(cmd, name));
                }
            } else {
                ret.push('"');
            }

            ret.push(', function(');
            ret.push(cooGetParamsDecl(params));
            ret.push(') {');

            return ret.join('');
        };

        cmd.getCodeAfter = function() {
            return '}, this)';
        };
    }


    function cmdProcessEvents(cmd) {
        return cooMatchCommand(cmd, extend({
            'ADD': {
                '*': function() {
                    // ADD identifier identifier2 ...
                    return cmdProcessEvent(cmd, false, 1);
                }
            },

            'REMOVE': {

            },

            'CHANGE': {
                '(': {
                    '*': function() {
                        // CHANGE (expr) identifier identifier2 ...
                        return cmdProcessEvent(cmd, true, 2);
                    }
                },

                '': {
                    '*': function() {
                        // CHANGE identifier identifier2 ...
                        return cmdProcessEvent(cmd, false, 2);
                    }
                }
            },

            'DESTROY': function() {
                return cmdProcessEvent(cmd, false, false);
            }
        }, subCommandExt));
    }


    function cmdProcessParams(cmd) {
        return cooMatchCommand(cmd, {
            'PARAM': {
                '': {
                    '@': function() {
                        return cooProcessParam(cmd, false);
                    },

                    '(': function() {
                        return cooProcessParam(cmd, true);
                    }
                }
            }
        });
    }


    function cmdProcessParamsAndEvents(cmd) {
        var ret = cmdProcessEvents(cmd),
            ret2;

        if (ret) {
            ret2 = cmdProcessParams(cmd);
        }

        return ret2 ? ret : ret2;
    }


    CooCoo.cmd.SUPER = {
        process: function(cmd) {
            return cooMatchCommand(cmd, {
                'SUPER': {
                    '#': function() {
                        cmd.hasSubblock = true;

                        cmd.data.params = cooExtractParamValues(cmd, 1);

                        cmd.processChild = cmdProcessParams;

                        cmd.getCodeBefore = function() {
                            var decl = cooGetDecl(cmd.root),
                                method,
                                ret = [];

                            method = cmd;
                            while (method.parent !== cmd.root) {
                                method = method.parent;
                            }

                            var hasParentMethod,
                                decls = cmd.decls[cmdName],
                                extDecl = decls[decl.data.exts];

                            method = method.data.actualName;

                            while (extDecl) {
                                if (method in extDecl.data.methods) {
                                    hasParentMethod = true;
                                    break;
                                }

                                extDecl = extDecl.data.exts ? decls[extDecl.data.exts] : null;
                            }

                            if (!hasParentMethod) {
                                cmd.parts[0].error = 'No parent method to call';
                                cmd.file.errorUnexpectedPart(cmd.parts[0]);
                            }

                            if (cmd.valuePusher) {
                                ret.push(COO_INTERNAL_VARIABLE_RET);
                                ret.push('.push(');
                            }

                            ret.push(cmdStorage);
                            ret.push('.');
                            ret.push(cmd.root.parts[1].value);
                            ret.push('.__super__.');
                            ret.push(method);
                            ret.push('.call(this');

                            var tmp = cooGetParamValues(cmd, extDecl.data.methods[method], cmd.data.params, cmd.data.elemParams);
                            if (tmp) {
                                ret.push(', ');
                                ret.push(tmp);
                            }

                            if (cmd.valuePusher) {
                                ret.push(')');
                            }

                            ret.push(');');

                            return ret.join('');
                        };
                    }
                }
            });
        },
        arrange: null,
        base: null
    };


    CooCoo.cmd[cmdName] = {
        process: cmdProcess,
        type: {
            validate: function(file, part) {
                if (part.value.length > 2) {
                    file.errorUnexpectedPart(part.value[2]);
                }

                if (part.value[1] && part.value[1].type !== COO_COMMAND_PART_IDENTIFIER) {
                    file.errorUnexpectedPart(part.value[1]);
                }
            },
            getAssertExpression: function(cmd, part, val) {
                cooGetDecl(cmd, part);
                var ret = [];

                ret.push('CooCooRet(');
                ret.push(val);
                ret.push(').valueOf() instanceof ');
                if (part.value[1]) {
                    ret.push(cmdStorage);
                    ret.push('.');
                    ret.push(part.value[1].value);
                } else {
                    ret.push(baseClass.name);
                }

                return ret.join('');
            }
        },
        arrange: function(declCmd, cmdList) {
            var decls = declCmd[cmdName],
                arranged = {},
                initialName,
                key,
                cmd,
                data,
                depProps,
                depCmd;

            for (key in decls) {
                cmd = decls[key];
                data = cmd.data;

                if (data.exts) {
                    depCmd = cmd;
                    depProps = data;
                    initialName = depProps.name;

                    while (depProps.exts) {
                        if (depProps.exts in decls) {
                            if (depProps.exts === initialName) {
                                depCmd.parts[3].error = 'Circular dependency';
                                depCmd.file.errorUnexpectedPart(depCmd.parts[3]);
                            }
                        } else {
                            depCmd.file.errorUndeclared(depCmd.parts[3]);
                        }

                        if (!(arranged[depProps.exts])) {
                            arranged[depProps.exts] = decls[depProps.exts];
                        }
                        depCmd = decls[depProps.exts];
                        depProps = decls[depProps.exts].data;
                    }
                }

                if (!(data.name in arranged)) {
                    arranged[data.name] = cmd;
                }
            }


            cmd = [];
            for (key in arranged) {
                cmd.push(arranged[key]);
            }

            Array.prototype.splice.apply(cmdList, [0, 0].concat(cmd));
        },
        base: cmdName.toLowerCase()
    };
}


CooCoo.cmd = {};

module.exports = CooCoo;
