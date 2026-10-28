/*!
 * sitio.js — motor liviano de plantillas de tomasramirezdev.com
 * Interpreta las plantillas de cada página ({{dato}}, <sc-for>, <sc-if> y eventos)
 * y actualiza solo lo que cambia usando morphdom (incluido en assets/js/morphdom.min.js).
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ONLY = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var BUBBLING = ['click', 'input', 'change', 'submit', 'keydown'];
  var DIRECT = ['mouseenter', 'mouseleave'];

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(patch, cb) {
      var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__app) this.__app.schedule(cb);
    }
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;

  function lookup(path, scope) {
    var parts = path.split('.');
    var v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }

  function fill(str, scope) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(p, scope);
      return v == null ? '' : String(v);
    });
  }

  function build(node, scope, parent, ctx) {
    var kids = node.childNodes;
    for (var k = 0; k < kids.length; k++) {
      var child = kids[k];
      if (child.nodeType === 3) {
        var t = child.nodeValue;
        parent.appendChild(document.createTextNode(t.indexOf('{{') < 0 ? t : fill(t, scope)));
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.localName;

      if (tag === 'sc-for') {
        var m = ONLY.exec(child.getAttribute('list') || '');
        var list = m ? lookup(m[1], scope) : null;
        var as = child.getAttribute('as') || 'item';
        if (list && list.length) {
          for (var i = 0; i < list.length; i++) {
            var sub = Object.create(scope);
            sub[as] = list[i];
            build(child, sub, parent, ctx);
          }
        }
        continue;
      }
      if (tag === 'sc-if') {
        var mi = ONLY.exec(child.getAttribute('value') || '');
        if (mi && lookup(mi[1], scope)) build(child, scope, parent, ctx);
        continue;
      }

      var el = child.namespaceURI === SVG_NS ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
      var attrs = child.attributes;
      for (var a = 0; a < attrs.length; a++) {
        var n = attrs[a].name;
        var v = attrs[a].value;
        if (n.indexOf('hint-placeholder') === 0) continue;
        if (n.length > 2 && n.charAt(0) === 'o' && n.charAt(1) === 'n') {
          var mh = ONLY.exec(v);
          var fn = mh ? lookup(mh[1], scope) : null;
          if (typeof fn === 'function') el.setAttribute('data-on-' + n.slice(2), ctx.reg(fn));
          continue;
        }
        if (n === 'key') { el.setAttribute('data-key', fill(v, scope)); continue; }
        if (v.indexOf('{{') < 0) { el.setAttribute(n, v); continue; }
        if (n === 'value' || n === 'checked' || n === 'selected') el._dcCtl = true;
        var ms = ONLY.exec(v);
        if (ms) {
          var raw = lookup(ms[1], scope);
          if (raw === false || raw == null) continue;
          el.setAttribute(n, raw === true ? '' : String(raw));
        } else {
          el.setAttribute(n, fill(v, scope));
        }
      }
      build(child, scope, el, ctx);
      if (tag === 'select' && el.hasAttribute('value')) {
        var val = el.getAttribute('value');
        el.removeAttribute('value');
        for (var o = 0; o < el.options.length; o++) {
          if (el.options[o].value === val) el.options[o].setAttribute('selected', '');
        }
      }
      parent.appendChild(el);
    }
  }

  function keepUserInput(fromEl, toEl) {
    if (toEl._dcCtl) return;
    var name = fromEl.nodeName;
    if (name === 'INPUT') {
      if (fromEl.type === 'checkbox' || fromEl.type === 'radio') toEl.checked = fromEl.checked;
      else toEl.value = fromEl.value;
    } else if (name === 'TEXTAREA') {
      toEl.value = fromEl.value;
    } else if (name === 'SELECT') {
      var i = fromEl.selectedIndex;
      if (i >= 0 && toEl.options && toEl.options[i]) toEl.options[i].setAttribute('selected', '');
    }
  }

  function App(Comp, root, tpl) {
    this.root = root;
    this.tpl = tpl;
    this.handlers = [];
    this.pending = false;
    this.callbacks = [];
    this.comp = new Comp({});
    this.comp.__app = this;
  }

  App.prototype.render = function () {
    var vals = this.comp.renderVals() || {};
    var handlers = [];
    var ctx = { reg: function (fn) { handlers.push(fn); return String(handlers.length - 1); } };
    var next = document.createElement('div');
    build(this.tpl.content, vals, next, ctx);
    this.handlers = handlers;
    window.morphdom(this.root, next, {
      childrenOnly: true,
      getNodeKey: function (node) {
        return node.getAttribute ? (node.getAttribute('data-key') || node.id || undefined) : undefined;
      },
      onBeforeElUpdated: function (fromEl, toEl) {
        if (fromEl.isEqualNode(toEl)) return false;
        keepUserInput(fromEl, toEl);
        return true;
      }
    });
  };

  App.prototype.schedule = function (cb) {
    if (cb) this.callbacks.push(cb);
    if (this.pending) return;
    this.pending = true;
    var self = this;
    Promise.resolve().then(function () {
      self.pending = false;
      self.render();
      var cbs = self.callbacks;
      self.callbacks = [];
      cbs.forEach(function (f) { f(); });
    });
  };

  App.prototype.bind = function () {
    var self = this;
    var root = this.root;
    BUBBLING.forEach(function (type) {
      root.addEventListener(type, function (e) {
        var el = e.target;
        while (el && el !== root) {
          if (el.nodeType === 1) {
            var id = el.getAttribute('data-on-' + type);
            if (id !== null) {
              var fn = self.handlers[+id];
              if (typeof fn === 'function') {
                if (type === 'submit') e.preventDefault();
                fn(e);
                if (e.cancelBubble) break;
              }
            }
          }
          el = el.parentNode;
        }
      });
    });
    DIRECT.forEach(function (type) {
      root.addEventListener(type, function (e) {
        var el = e.target;
        if (!el || el.nodeType !== 1) return;
        var id = el.getAttribute('data-on-' + type);
        if (id === null) return;
        var fn = self.handlers[+id];
        if (typeof fn === 'function') fn(e);
      }, true);
    });
  };

  // Menú de celular: se cierra al elegir una opción, al tocar afuera o con Escape.
  function closeMenus(except) {
    var open = document.querySelectorAll('details.mnav[open]');
    for (var i = 0; i < open.length; i++) if (open[i] !== except) open[i].removeAttribute('open');
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var menu = t && t.closest ? t.closest('details.mnav') : null;
    if (menu && t.closest('.mnav-panel a')) { menu.removeAttribute('open'); return; }
    closeMenus(menu);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(null); });

  window.DC = {
    mount: function (Comp) {
      var root = document.getElementById('dc-root');
      var tpl = document.getElementById('dc-tpl');
      if (!root || !tpl) return;
      var app = new App(Comp, root, tpl);
      app.bind();
      app.render();
      document.documentElement.classList.add('dc-ready');
      if (typeof app.comp.componentDidMount === 'function') app.comp.componentDidMount();
      window.__dcApp = app;
    }
  };
})();
