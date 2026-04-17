declare module '@koa/multer' {
  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination?: string;
    filename?: string;
    path?: string;
    buffer: Buffer;
  }

  interface MulterOptions {
    dest?: string;
    storage?: import('multer').StorageEngine;
    limits?: {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    };
    preservePath?: boolean;
    fileFilter?(
      req: unknown,
      file: File,
      callback: (error: Error | null, acceptFile: boolean) => void,
    ): void;
  }

  type KoaMiddleware = (ctx: unknown, next: () => Promise<void>) => Promise<void>;

  interface Instance {
    single(fieldname: string): KoaMiddleware;
    array(fieldname: string, maxCount?: number): KoaMiddleware;
    fields(fields: Array<{ name: string; maxCount?: number }>): KoaMiddleware;
    none(): KoaMiddleware;
    any(): KoaMiddleware;
  }

  interface KoaMulterFactory {
    (options?: MulterOptions): Instance;
    memoryStorage(): import('multer').StorageEngine;
    diskStorage(options: import('multer').DiskStorageOptions): import('multer').StorageEngine;
    File: File;
  }

  const multer: KoaMulterFactory;
  export = multer;
}
