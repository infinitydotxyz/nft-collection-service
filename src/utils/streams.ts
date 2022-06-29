import { Transform } from 'stream';

export function filterStream<T>(filterFn: (chunk: T) => boolean) {
  return new Transform({
    transform(chunk, encoding, callback) {
      if (filterFn(chunk as T)) {
        this.push(chunk);
      }
      callback();
    },
    objectMode: true
  });
}

export function pageStream<T>(pageSize: number) {
  let data: T[] = [];
  return new Transform({
    transform(chunk, encoding, callback) {
      data.push(chunk as T);
      if (data.length >= pageSize) {
        this.push(data);
        data = [];
      }
      callback();
    },
    flush(callback) {
      if (data.length > 0) {
        this.push(data);
      }
      callback();
    },
    objectMode: true,
    highWaterMark: pageSize
  });
}

