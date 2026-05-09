self.__uv$config = {
  prefix: "/service/uv/",
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: "/prox/uv/uv.handler.js",  
  client: "/prox/uv/uv.client.js",    
  bundle: "/prox/uv/uv.bundle.js",    
  config: "/prox/uv/uv.config.js",    
  sw: "/sw.js",
  worker: '/prox/baremux/worker.js',            
};