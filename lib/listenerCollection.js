/*!
 * Copyright(c) 2015 Jan Blaha
 *
 * ListenerCollection can hold array of listeners and fire them.
 * Each listener needs to have a key.
 */

const async = require('async')

const ListenerCollection = module.exports = function () {
  this._listeners = []
  this._pre = []
  this._post = []
  this._postFail = []
}

/**
 * Add listener cb at the end of the current chain.
 * @param {String} key
 * @param {Object|Function} context
 * @param {Function} listener
 */
ListenerCollection.prototype.add = function (key, context, listener) {
  this._listeners.push({
    key,
    fn: listener || context,
    context: listener === null ? this : context
  })
}

/**
 * Add the listener callback to the particular position in the chain.
 * The position is specified by the index in the array or a condition
 * Example
 * listeners.insert({ pre: "another", post: "another2" }, "foo", this, function() {... });
 *
 * @param {Number|Object} indexOrCondition
 * @param {String} key
 * @param {Object} context
 * @param {Function} listener
 */
ListenerCollection.prototype.insert = function (indexOrCondition, key, context, listener) {
  const listenerOpts = {
    key,
    fn: listener || context,
    context: listener === null ? this : context
  }

  if (!isNaN(indexOrCondition)) {
    return this._listeners.splice(indexOrCondition, 0, listenerOpts)
  }

  let afterInsertIndex = null
  let beforeInsertIndex = null

  for (let i = 0; i < this._listeners.length; i++) {
    if (this._listeners[i].key === indexOrCondition.after) {
      afterInsertIndex = i + 1
    }

    if (this._listeners[i].key === indexOrCondition.before) {
      beforeInsertIndex = i
    }
  }

  const index = afterInsertIndex !== null
    ? afterInsertIndex
    : (beforeInsertIndex !== null ? beforeInsertIndex : this._listeners.length)

  this._listeners.splice(index, 0, listenerOpts)
}

/**
 * Remove the listener specified by its key from the collection
 * @param {String} key
 */
ListenerCollection.prototype.remove = function (key) {
  this._listeners = this._listeners.filter(function (l) {
    return l.key !== key
  })
}

/* add hook that will be executed before actual listener */
ListenerCollection.prototype.pre = function (fn) {
  this._pre.push(fn)
}

/* add hook that will be executed after actual listener */
ListenerCollection.prototype.post = function (fn) {
  this._post.push(fn)
}

/* add hook that will be executed after actual listener when execution will fail */
ListenerCollection.prototype.postFail = function (fn) {
  this._postFail.push(fn)
}

/**
 * Fires listeners and returns value composed from all boolean results into the single bool
 * @returns {Promise<Boolean>}
 */
ListenerCollection.prototype.fireAndJoinResults = function () {
  return this.fire.apply(this, arguments).then(function (results) {
    const successes = results.filter(function (r) {
      return r === true
    })

    const failures = results.filter(function (r) {
      return r === false
    })

    const dontCares = results.filter(function (r) {
      return r === null || r === undefined
    })

    if (successes.length && (successes.length + dontCares.length === results.length)) {
      // override pass
      return true
    }

    if (failures.length && (failures.length + dontCares.length === results.length)) {
      return false
    }

    if (dontCares.length === results.length) {
      return null
    }

    return true
  })
}

/**
 * Fire registered listeners in sequence and returns a promise containing wrapping an array of all
 * individual results.
 * The parameters passed to the fire are forwarded in the same order to the listeners.
 * @returns {Promise<U>}
 */
ListenerCollection.prototype.fire = function () {
  const self = this

  const args = Array.prototype.slice.call(arguments, 0)

  const usePromises = args.length === 0 || !(typeof args[args.length - 1] === 'function')

  function mapSeries (arr, iterator) {
    // create a empty promise to start our series (so we can use `then`)
    let currentPromise = Promise.resolve()

    const promises = arr.map(function (el) {
      return (currentPromise = currentPromise.then(function () {
        // execute the next function after the previous has resolved successfully
        return iterator(el)
      }))
    })

    // group the results and return the group promise
    return Promise.all(promises)
  }

  function applyHook (l, hookArrayName, outerArgs) {
    self[hookArrayName].forEach(function (p) {
      p.apply(l, outerArgs)
    })
  }

  if (usePromises) {
    const results = []

    return mapSeries(this._listeners, function (l) {
      const currentArgs = args.slice(0)

      applyHook(l, '_pre', currentArgs)

      try {
        const valOrPromise = l.fn.apply(l.context, currentArgs)

        return Promise.resolve(valOrPromise).then(function (val) {
          applyHook(l, '_post', currentArgs)
          results.push(val)
          return Promise.resolve(val)
        }).catch(function (err) {
          currentArgs.unshift(err)
          applyHook(l, '_postFail', currentArgs)
          return Promise.reject(err)
        })
      } catch (e) {
        currentArgs.unshift(e)
        applyHook(l, '_postFail', currentArgs)
        return Promise.reject(e)
      }
    }).then(function () {
      return results
    })
  }

  // remove callback
  args.pop()

  return async.eachSeries(this._listeners, function (l, next) {
    const currentArgs = args.slice(0)
    currentArgs.push(next)
    l.fn.apply(l.context, currentArgs)
  }, arguments[arguments.length - 1])
}
