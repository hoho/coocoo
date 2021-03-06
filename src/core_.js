/* global window */
/* global document */
(function(window, undefined) {
    var objConstructor = {}.constructor,
        lastId = 0,

        CooCoo = window.CooCoo = {
            Extendable: function() {}
        },

        CooCooRenderRet = function() {
            this._ = document.createDocumentFragment();
            this._e = [];
        },

        CooCooRet = CooCoo.Ret = function(render) {
            return this.constructor === CooCooRet ?
                this
                :
                (render ? new CooCooRenderRet() : new CooCooRet());
        },

        cooUnwrap = CooCoo.u = function(val) {
            return val instanceof CooCooRet ? val.valueOf() : val;
        },

        isPlainObject = function(obj) {
            // XXX: Rather simplified version of isPlainObject. Fix in case of
            //      necessity.
            return obj && (obj.constructor === objConstructor);
        },

        CooCooHolder = CooCoo.DOMHolder = function() {
            // Creating comment node as placeholder.
            this._n = document.createComment(' CooCoo Holder ');

            // `this._e` will be set in case this holder is a part of top-level
            // nodes of CooCooRenderRet. This is the way to track view nodes
            // and remove them with view destruction.
        },

        CooCooPusher = CooCoo.DOMPusher = function(parent) {
            this._ = parent;
        },

        pushElement = function pushElement(dst, node) {
            /* jshint browser: true */
            if (dst && (node instanceof Node)) {
                if (node.nodeType === 11) {
                    // It's a document fragment.
                    node = node.firstChild;
                    while (node) {
                        dst.push(node);
                        node = node.nextSibling;
                    }
                } else {
                    dst.push(node);
                }
            }
            /* jshint browser: false */
        };


    CooCooHolder.prototype.push = function(node) {
        var self = this,
            n = self._n,
            e = self._e;

        if (n.parentNode) {
            if (node instanceof CooCooHolder) {
                node._e = e;
                node = node._n;
            }

            pushElement(e, node);

            // XXX: Might not work for all the cases,
            //      do think about it further.
            n.parentNode.insertBefore(node, n);
        }
    };


    CooCoo.reset = function(val, prev) {
        if (prev instanceof CooCoo.Extendable) { prev.destroy(); }
        return cooUnwrap(val);
    };


    CooCooRet.prototype.push = function(val) {
        this._ = cooUnwrap(val);
    };

    CooCooRet.prototype.valueOf = function() {
        return this._;
    };

    CooCooRet.prototype.isEmpty = function() {
        return this._ === undefined;
    };

    CooCooRenderRet.prototype.push = CooCooPusher.prototype.push = function(val) {
        // TODO: This element tracking is ugly and buggy. Redo it completely.
        var e = this._e;

        val = cooUnwrap(val);

        if (val instanceof CooCooHolder) {
            val._e = e;
            val = val._n;
        }

        pushElement(e, val);

        this._.appendChild(val);
    };


    CooCoo.Extendable.prototype = {
        init: function(parent/*, ...*/) {
            var self = this;

            self.__id = 'i' + (++lastId);
            self.__parent = parent;

            if (parent) {
                self.__root = parent.__root || parent;
                parent.__children[self.__id] = self;
            }

            self.__children = {};

            //console.log('Create: ' + self.__what);

            self.__construct.apply(self, Array.prototype.slice.call(arguments, 1));
        },

        destroy: function() {
            var self = this,
                children = self.__children,
                i,
                c;

            self.__destroyed = true;
            self.__destruct();

            for (i in children) {
                c = children[i];
                !c.__destroyed && c.destroy();
            }

            if (self.__parent && !self.__parent.__destroyed) {
                delete self.__parent.__children[self.__id];
            }

            self.__parent = self.__children = null;

            //console.log('Destroy: ' + self.__what);
        },

        __construct: function() {},

        __destruct: function() {}
    };


    CooCoo.Extendable.extend = function(obj) {
        var self = this,
            proto,
            key,

            F = function() {},

            CooCooBase = function CooCooBase() {
                return this.init.apply(this, arguments);
            };

        F.prototype = self.prototype;
        proto = CooCooBase.prototype = new F();

        proto.constructor = CooCooBase;

        for (key in obj) {
            proto[key] = obj[key];
        }

        CooCooBase.extend = CooCoo.Extendable.extend;
        CooCooBase.__super__ = self.prototype;

        return CooCooBase;
    };


    CooCoo.Base = CooCoo.Extendable.extend({
        init: function(/*parent, ...*/) {
            var self = this;
            // Storage for event handlers.
            self.__h = {};
            // Storage for properties.
            self.__d = {};
            // Storage for internal destroy handlers.
            self.__dh = [];
            // Storage for event propagation parents.
            self.__e = {};

            CooCoo.Base.__super__.init.apply(this, arguments);
        },

        destroy: function() {
            var self = this,
                i;

            if (self.__destroyed) { return; }

            self.trigger('destroy');

            if (self.__destroyed) { return; }

            for (i = 0; i < self.__dh.length; i++) {
                self.__dh[i]();
            }

            CooCoo.Base.__super__.destroy.call(self);

            self.__h = self.__d = self.__dh = self.__e = null;
        },

        __construct: function(attrs) {
            attrs = cooUnwrap(attrs);
            if (isPlainObject(attrs)) { this.__d = attrs; }
        },

        on: function(name, callback, context) {
            var self = this,
                sep = name.indexOf(':'),
                prop,
                handlers,
                dest;

            if (sep < 0) { sep = name.length; }

            prop = name.substring(sep + 1);
            name = name.substring(0, sep);

            if (!((handlers = self.__h[name]))) {
                handlers = self.__h[name] = {props: {}, any: []};
            }

            if (prop) {
                if (!((dest = handlers.props[prop]))) {
                    dest = handlers.props[prop] = [];
                }
            } else {
                dest = handlers.any;
            }

            dest.push((prop = [callback, context]));

            // Remove handler on context destruction.
            context.__dh.push(function() {
                for (sep = 0; sep < dest.length; sep++) {
                    if (dest[sep] === prop) {
                        dest.splice(sep, 1);
                        break;
                    }
                }
            });

            return self;
        },

        trigger: function(name/*, ...*/) {
            var self = this,
                nameSrc = name,
                sep = name.indexOf(':'),
                prop,
                handlers,
                i,
                callbacks,
                callback,
                args = Array.prototype.splice.call(arguments, 1);

            if (sep < 0) { sep = name.length; }

            prop = name.substring(sep + 1);
            name = name.substring(0, sep);

            if ((handlers = self.__h[name])) {
                callbacks = handlers.any;

                for (i = 0; i < callbacks.length; i++) {
                    callback = callbacks[i];
                    callback[0].apply(callback[1] || self, args);
                }

                if (prop && ((callbacks = handlers.props[prop]))) {
                    for (i = 0; i < callbacks.length; i++) {
                        callback = callbacks[i];
                        callback[0].apply(callback[1] || self, args);
                    }
                }
            }

            args.unshift(self);
            args.unshift(nameSrc);
            // Reuse prop and handlers variables.
            handlers = self.__e;
            for (i in handlers) {
                prop = handlers[i];
                prop.trigger.apply(prop, args);
            }

            return self;
        },

        set: function(name, val, reset) {
            var self = this,
                vals,
                n,
                data = self.__d,
                prev;

            name = cooUnwrap(name);

            if (isPlainObject(name)) {
                vals = name;
            } else {
                vals = {};
                vals[name] = cooUnwrap(val);
            }

            for (n in vals) {
                prev = data[n];
                val = data[n] = vals[n];

                if (val !== prev) {
                    if (reset) {
                        prev = CooCoo.reset(undefined, prev);
                    }

                    self.trigger('change:' + n, val, n, prev);
                }
            }

            return self;
        },

        get: function(name) {
            var d = this.__d;
            return name === undefined ? d : d[name];
        }
    });
})(window);
