import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Image as ImageIcon, FileText, Trash2, Upload, X, Loader2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { toast } from 'sonner';

export default memo(({ data, isConnectable }: any) => {
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo no puede pesar más de 10MB');
      return;
    }

    try {
      setIsUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2, 15)}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      // Determinar si es imagen o documento
      const isImage = file.type.startsWith('image/');
      const mediaType = isImage ? 'image' : 'document';

      // 1. Upload to Supabase Storage in 'whatsapp_media' bucket
      const { error: uploadError } = await supabase.storage
        .from('whatsapp_media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        if (uploadError.message.includes('Bucket not found')) {
            throw new Error('El bucket "whatsapp_media" no existe en Supabase Storage. Debes crearlo primero.');
        }
        throw uploadError;
      }

      // 2. Get Public URL
      const { data: urlData } = supabase.storage
        .from('whatsapp_media')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      // 3. Save Node Data
      if (data.onChangeMediaUrl) data.onChangeMediaUrl(publicUrl);
      if (data.onChangeMediaType) data.onChangeMediaType(mediaType);
      if (data.onChangeFileName) data.onChangeFileName(file.name);
      if (data.onChangeMimeType) data.onChangeMimeType(file.type);
      
      toast.success('Archivo subido correctamente');
    } catch (error: any) {
      console.error('Upload Error:', error);
      toast.error(error.message || 'Error al subir el archivo');
    } finally {
      setIsUploading(false);
      // Reset input
      if (e.target) e.target.value = '';
    }
  };

  const removeMedia = () => {
    if (data.onChangeMediaUrl) data.onChangeMediaUrl('');
    if (data.onChangeMediaType) data.onChangeMediaType('');
    if (data.onChangeFileName) data.onChangeFileName('');
    if (data.onChangeMimeType) data.onChangeMimeType('');
  };

  return (
    <div className="bg-white rounded-lg shadow-lg border border-indigo-200 w-64">
      <div className="bg-indigo-600 text-white p-2 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
            <ImageIcon size={16} />
            <span className="font-medium text-sm">Enviar Multimedia</span>
        </div>
        <button onClick={data.onDelete} className="text-white hover:text-indigo-200 transition">
            <Trash2 size={14} />
        </button>
      </div>
      <div className="p-3 space-y-3">
        
        {/* Media Upload Area */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-3 text-center relative hover:bg-gray-50 flex flex-col items-center justify-center min-h-[80px]">
           {isUploading ? (
               <div className="flex flex-col items-center justify-center text-indigo-500">
                  <Loader2 className="animate-spin mb-1" size={24} />
                  <span className="text-xs">Subiendo...</span>
               </div>
           ) : data.mediaUrl ? (
               <div className="relative w-full text-center">
                    <button 
                        onClick={removeMedia}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 z-10"
                    >
                        <X size={12} />
                    </button>
                    {data.mediaType === 'image' ? (
                        <div className="flex flex-col items-center">
                            <img src={data.mediaUrl} alt="Preview" className="h-16 w-auto object-cover rounded shadow-sm mb-1" />
                            <span className="text-[10px] text-gray-500 truncate w-full px-2" title={data.fileName}>{data.fileName}</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            <FileText className="text-red-500" size={32} />
                            <span className="text-[10px] text-gray-600 truncate w-full px-2 font-medium" title={data.fileName}>{data.fileName || 'Documento'}</span>
                        </div>
                    )}
               </div>
           ) : (
               <>
                <Upload className="text-gray-400 mb-1" size={20} />
                <span className="text-[10px] text-gray-500">Subir JPG o PDF (máx 10MB)</span>
                <input 
                    type="file" 
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
               </>
           )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Texto o Caption (Opcional)</label>
          <textarea
            className="w-full text-xs p-2 border rounded resize-none focus:outline-none focus:border-indigo-500"
            rows={2}
            value={data.caption || ''}
            onChange={(evt) => data.onChangeCaption && data.onChangeCaption(evt.target.value)}
            placeholder="Ej: Te adjunto nuestro catálogo..."
          />
        </div>
        
      </div>
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
    </div>
  );
});
