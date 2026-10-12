// IndexedDB mínima: un único store clave → valor. Los datos van enteros en la clave `datos`.

const NOMBRE = 'a-ojo';
let abierta = null;

function abrir() {
  if (!abierta) {
    abierta = new Promise((resolver, rechazar) => {
      const pedido = indexedDB.open(NOMBRE, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('kv');
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rechazar(pedido.error);
    });
    abierta.catch(() => { abierta = null; });
  }
  return abierta;
}

function operar(modo, fn) {
  return abrir().then(db => new Promise((resolver, rechazar) => {
    const tx = db.transaction('kv', modo);
    const pedido = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolver(pedido.result);
    tx.onerror = () => rechazar(tx.error);
    tx.onabort = () => rechazar(tx.error);
  }));
}

export function leer(clave) {
  return operar('readonly', store => store.get(clave));
}

export function guardar(clave, valor) {
  return operar('readwrite', store => store.put(valor, clave));
}

export function borrar(clave) {
  return operar('readwrite', store => store.delete(clave));
}
