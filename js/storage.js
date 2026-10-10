/* EvoBuskin V12 — private Storage client helpers. No service-role secret. */
(function(){
  const BUCKET='evobuskin-private';
  function uuid(){return crypto.randomUUID();}
  function safeName(name){return String(name||'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}
  function path(businessId,category,originalName){return `${businessId}/${category}/${uuid()}-${safeName(originalName)}`}
  async function upload({supabase,businessId,category,file}){
    if(!supabase?.storage) throw new Error('STORAGE_NOT_READY');
    if(!businessId||!category||!file) throw new Error('INVALID_FILE');
    const allowed=['image/jpeg','image/png','image/webp','application/pdf'];
    if(!allowed.includes(file.type)) throw new Error('INVALID_MIME_TYPE');
    if(file.size<=0||file.size>5*1024*1024) throw new Error('FILE_TOO_LARGE');
    const objectName=path(businessId,category,file.name);
    const {error}=await supabase.storage.from(BUCKET).upload(objectName,file,{upsert:false,contentType:file.type,cacheControl:'3600'});
    if(error) throw error;
    try{
      const {data,error:e}=await supabase.rpc('v12_register_file',{p_business_id:businessId,p_object_name:objectName,p_category:category,p_mime_type:file.type,p_size_bytes:file.size,p_sha256:null});
      if(e) throw e;
      return {objectName,metadata:data};
    }catch(e){
      await supabase.storage.from(BUCKET).remove([objectName]).catch(()=>{});
      throw e;
    }
  }
  async function signedUrl({supabase,objectName,seconds=300}){
    if(!supabase?.storage) throw new Error('STORAGE_NOT_READY');
    const ttl=Math.max(60,Math.min(900,Number(seconds)||300));
    const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(objectName,ttl);
    if(error) throw error; return data.signedUrl;
  }
  window.EvoBuskinStorage={BUCKET,upload,signedUrl};
})();
