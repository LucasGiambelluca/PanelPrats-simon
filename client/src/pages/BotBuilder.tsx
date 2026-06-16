
import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
} from 'reactflow';
import type { Connection, Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { Save, Trash2, Download, Upload, Menu, X, Plus, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { flowsApi } from '../lib/api';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/bot-builder/Sidebar';
import MessageNode from '../components/bot-builder/MessageNode';
import QuestionNode from '../components/bot-builder/QuestionNode';
import ConditionalNode from '../components/bot-builder/ConditionNode';
import PollNode from '../components/bot-builder/PollNode';
import FlowLinkNode from '../components/bot-builder/FlowLinkNode';
import MediaUploadNode from '../components/bot-builder/MediaUploadNode';
import DocumentGeneratorNode from '../components/bot-builder/DocumentGeneratorNode';
import ThreadNode from '../components/bot-builder/ThreadNode';
import TimerNode from '../components/bot-builder/TimerNode';
import ReportNode from '../components/bot-builder/ReportNode';
import AppointmentNode from '../components/bot-builder/AppointmentNode';
import AppointmentAvailabilityNode from '../components/bot-builder/AppointmentAvailabilityNode';
import AppointmentProposalsNode from '../components/bot-builder/AppointmentProposalsNode';
import HandoverNode from '../components/bot-builder/HandoverNode';
import BusinessHoursNode from '../components/bot-builder/BusinessHoursNode';
import SendMediaNode from '../components/bot-builder/SendMediaNode';
import MobileNodeSelector from '../components/bot-builder/MobileNodeSelector';
import GroqNode from '../components/bot-builder/GroqNode';
import IntentResolverNode from '../components/bot-builder/IntentResolverNode';
import AudioTranscriberNode from '../components/bot-builder/AudioTranscriberNode';
import AIAgentNode from '../components/bot-builder/AIAgentNode';
import MediaTypeDetectorNode from '../components/bot-builder/MediaTypeDetectorNode';
import WebhookNode from '../components/bot-builder/WebhookNode';
import BufferMemoryNode from '../components/bot-builder/BufferMemoryNode';
import KeywordNode from '../components/bot-builder/KeywordNode';
import SwitchNode from '../components/bot-builder/SwitchNode';
import TextSplitterNode from '../components/bot-builder/TextSplitterNode';
import ArraySwitchNode from '../components/bot-builder/ArraySwitchNode';

// Register custom node types (24 generic — no commerce nodes)
const nodeTypes = {
  messageNode: MessageNode,
  questionNode: QuestionNode,
  conditionNode: ConditionalNode,
  pollNode: PollNode,
  flowLinkNode: FlowLinkNode,
  mediaUploadNode: MediaUploadNode,
  documentNode: DocumentGeneratorNode,
  threadNode: ThreadNode,
  timerNode: TimerNode,
  reportNode: ReportNode,
  appointmentNode: AppointmentNode,
  appointmentAvailabilityNode: AppointmentAvailabilityNode,
  appointmentProposalsNode: AppointmentProposalsNode,
  handoverNode: HandoverNode,
  businessHoursNode: BusinessHoursNode,
  sendMediaNode: SendMediaNode,
  groqNode: GroqNode,
  intentResolverNode: IntentResolverNode,
  audioTranscriberNode: AudioTranscriberNode,
  aiAgentNode: AIAgentNode,
  mediaTypeDetectorNode: MediaTypeDetectorNode,
  mediaDetectorNode: MediaTypeDetectorNode,
  webhookNode: WebhookNode,
  bufferMemoryNode: BufferMemoryNode,
  keywordNode: KeywordNode,
  switchNode: SwitchNode,
  textSplitterNode: TextSplitterNode,
  arraySwitchNode: ArraySwitchNode,
};

const initialNodes: Node[] = [
  {
    id: 'start',
    type: 'input',
    data: { label: 'Inicio (Palabra Clave: Hola)' },
    position: { x: 250, y: 5 },
    style: { background: '#22c55e', color: 'white', border: 'none', fontWeight: 'bold' }
  },
];

// Generate unique IDs for nodes safely so they don't clash with loaded JSON
const getId = () => `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export default function BotBuilder() {
  const { activeAccountId } = useAccounts();
  const { user } = useAuth();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  
  const [flows, setFlows] = useState<any[]>([]);
  const [currentFlowId, setCurrentFlowId] = useState<string | number | null>(null);
  const [flowName, setFlowName] = useState('Nuevo Flujo');
  const [trigger, setTrigger] = useState('hola');
  const [isActive, setIsActive] = useState(true);
  
  // Mobile states
  const [isNodeSelectorOpen, setIsNodeSelectorOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Lista TODOS los flujos del usuario (across cuentas) para poder editarlos.
  // Se refresca también al cambiar de cuenta activa (p.ej. tras crear un flujo nuevo).
  useEffect(() => {
    fetchFlows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeAccountId]);

  const fetchFlows = async () => {
    if (!user?.id) {
      setFlows([]);
      return;
    }
    try {
      const data = await flowsApi.listByUser(user.id);
      setFlows(data);
    } catch (err) {
      console.error('[BotBuilder] Error fetching flows:', err);
    }
  };

  const updateNodeData = useCallback((id: string, data: any) => {
    setNodes((nds) => nds.map((node) => node.id === id ? { ...node, data: { ...node.data, ...data } } : node));
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
  }, [setNodes, setEdges]);

  const prepareNodes = useCallback((nodes: any[]) => {
    return (nodes || []).map((n: any) => {
      let nodeData = {};
      try {
        nodeData = typeof n.data === 'string' ? JSON.parse(n.data) : (n.data || {});
      } catch (err) {
        console.error('[BotBuilder] Error parsing data:', err);
        nodeData = n.data || {};
      }

      let nodePos = { x: 0, y: 0 };
      try {
        nodePos = typeof n.position === 'string' ? JSON.parse(n.position) : (n.position || { x: 0, y: 0 });
      } catch (err) {
        console.error('[BotBuilder] Error parsing position:', err);
        nodePos = n.position || { x: 0, y: 0 };
      }

      return {
        ...n,
        position: nodePos,
        data: {
          ...nodeData,
          onChange: (text: string) => updateNodeData(n.id, { text }),
          onChangeQuestion: (q: string) => updateNodeData(n.id, { question: q }),
          onChangeVariable: (v: string) => updateNodeData(n.id, { variable: v }),
          onChangeOptions: (o: string[]) => updateNodeData(n.id, { options: o }),
          onChangeSaveField: (f: string) => updateNodeData(n.id, { saveField: f }),
          onChangeFlow: (f: string) => updateNodeData(n.id, { flowId: f }),
          onChangeProductVar: (v: string) => updateNodeData(n.id, { productVariable: v }),
          onChangeQtyVar: (v: string) => updateNodeData(n.id, { qtyVariable: v }),
          onChangeDetailVar: (v: string) => updateNodeData(n.id, { detailVariable: v }),
          onChangeDuration: (d: string) => updateNodeData(n.id, { duration: d }),
          onChangeShowTyping: (t: boolean) => updateNodeData(n.id, { showTyping: t }),
          onChangeReportType: (t: string) => updateNodeData(n.id, { reportType: t }),
          onChangePriority: (p: string) => updateNodeData(n.id, { priority: p }),
          onChangeMessage: (m: string) => updateNodeData(n.id, { message: m }),
          onChangeMediaUrl: (u: string) => updateNodeData(n.id, { mediaUrl: u }),
          onChangeCaption: (c: string) => updateNodeData(n.id, { caption: c }),
          onChangeMediaType: (t: string) => updateNodeData(n.id, { mediaType: t }),
          onChangeFileName: (n_name: string) => updateNodeData(n.id, { fileName: n_name }),
          onChangeMimeType: (m: string) => updateNodeData(n.id, { mimetype: m }),
          onChangePrompt: (p: string) => updateNodeData(n.id, { prompt: p }),
          onChangeSystemPrompt: (s: string) => updateNodeData(n.id, { systemPrompt: s }),
          onChangeTemperature: (t: number) => updateNodeData(n.id, { temperature: t }),
          onChangeSilent: (s: boolean) => updateNodeData(n.id, { silent: s }),
          onChangePossibleIntents: (i: string) => updateNodeData(n.id, { possible_intents: i }),
          onChangeFallbackMessage: (m: string) => updateNodeData(n.id, { fallback_message: m }),
          onChangeMaxRetries: (r: number) => updateNodeData(n.id, { max_retries: r }),
          onChangeOutputVariable: (v: string) => updateNodeData(n.id, { output_variable: v }),
          onChangeInputVariable: (v: string) => updateNodeData(n.id, { inputVariable: v }),
          onChangeThreshold: (v: number) => updateNodeData(n.id, { threshold: v }),
          onChangeContextVariables: (c: string[]) => updateNodeData(n.id, { context_variables: c }),
          onChangeKeywords: (k: any[]) => updateNodeData(n.id, { keywords: k }),
          onChangeCases: (c: any[]) => updateNodeData(n.id, { cases: c }),
          onChangeValue: (key: string, val: any) => updateNodeData(n.id, { [key]: val }),
          onDelete: () => deleteNode(n.id),
        }
      };
    });
  }, [updateNodeData, deleteNode]);

  const loadFlow = useCallback((flow: any) => {
      console.log('🔄 Loading Flow:', flow);
      setCurrentFlowId(flow.id);
      setFlowName(flow.name);
      setTrigger(flow.trigger_word);
      setIsActive(flow.is_active);
      
      const restoredNodes = prepareNodes(flow.nodes || []);
      console.log('🔄 Setting Nodes:', restoredNodes);
      setNodes(restoredNodes);
      setEdges(flow.edges || []);
      toast.info(`Flujo "${flow.name}" cargado`);
  }, [prepareNodes, setNodes, setEdges]);

  const createNewFlow = useCallback(() => {
      setCurrentFlowId(null);
      setFlowName('Nuevo Flujo');
      setTrigger('nuevo');
      setIsActive(true);
      setNodes(prepareNodes(initialNodes));
      setEdges([]);
  }, [prepareNodes, setNodes, setEdges]);

  // Initial preparation for nodes on mount
  useEffect(() => {
    setNodes((nds) => prepareNodes(nds));
  }, []);

  const onConnect = useCallback((params: Connection | Edge) => {
    // Only create edges for explicit handle-to-handle connections
    if (!params.source || !params.target || params.source === params.target) return;
    setEdges((eds) => addEdge(params, eds));
  }, [setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);



  const addNodeByType = useCallback((type: string, position?: { x: number, y: number }) => {
      const pos = position || (reactFlowInstance ? reactFlowInstance.getViewport() : { x: 0, y: 0, zoom: 1 });
      const finalPosition = position || { 
          x: (-pos.x + window.innerWidth / 2) / pos.zoom, 
          y: (-pos.y + window.innerHeight / 2) / pos.zoom 
      };

      const newNode: Node = {
        id: getId(),
        type,
        position: finalPosition,
        data: { 
            // Default data
            text: type === 'messageNode' || type === 'mediaUploadNode' ? '' : undefined,
            caption: type === 'sendMediaNode' ? '' : undefined,
            mediaUrl: type === 'sendMediaNode' ? '' : undefined,
            mediaType: type === 'sendMediaNode' ? '' : undefined,
            duration: type === 'timerNode' ? 1000 : undefined,
            showTyping: type === 'timerNode' ? true : undefined,
            systemPrompt: type === 'groqNode' ? 'Sos un asistente virtual de atención al cliente.' : undefined,
            prompt: type === 'groqNode' ? 'Analizá este mensaje: {{respuesta}}' : undefined,
            variable: type === 'questionNode' || type === 'pollNode' || type === 'mediaUploadNode' || type === 'groqNode' || type === 'intentResolverNode' ? (type === 'mediaUploadNode' ? 'file_url' : type === 'groqNode' ? 'ai_response' : type === 'intentResolverNode' ? 'intent_clasificado' : 'respuesta') : type === 'arraySwitchNode' ? 'split_words' : undefined,
            temperature: type === 'groqNode' ? 0.7 : undefined,
            silent: type === 'groqNode' ? false : undefined,
            possible_intents: type === 'intentResolverNode' ? 'consulta, soporte, cancelar, no_entendido' : type === 'aiAgentNode' ? 'consulta,saludo,soporte,cancelar' : undefined,
            // AppointmentNode defaults
            nombreVar: type === 'appointmentNode' ? 'nombre' : undefined,
            telefonoVar: type === 'appointmentNode' ? 'telefono' : undefined,
            resumenVar: type === 'appointmentNode' ? 'resumen' : undefined,
            dateVar: type === 'appointmentNode' || type === 'appointmentAvailabilityNode' ? 'fecha' : undefined,
            startHourVar: type === 'appointmentNode' || type === 'appointmentAvailabilityNode' ? 'hora_inicio' : undefined,
            endHourVar: type === 'appointmentNode' || type === 'appointmentAvailabilityNode' ? 'hora_fin' : undefined,
            // AppointmentProposalsNode defaults
            allowedDays: type === 'appointmentProposalsNode' ? [1, 2, 3, 4, 5] : undefined,
            startHour: type === 'appointmentProposalsNode' ? '09:00' : undefined,
            endHour: type === 'appointmentProposalsNode' ? '18:00' : undefined,
            slotDuration: type === 'appointmentProposalsNode' ? 60 : undefined,
            maxProposals: type === 'appointmentProposalsNode' ? 3 : undefined,
            outputVariable: type === 'appointmentProposalsNode' ? 'horarios_disponibles' : undefined,
            max_retries: type === 'intentResolverNode' ? 2 : undefined,
            fallback_message: type === 'intentResolverNode' ? 'No te entendí bien. ¿Podrías expresarlo con otras palabras?' : undefined,
            context_variables: type === 'intentResolverNode' ? [] : undefined,
            // Audio Transcriber defaults
            language: type === 'audioTranscriberNode' ? 'es' : undefined,
            output_variable: type === 'audioTranscriberNode' ? 'transcripcion' : type === 'aiAgentNode' ? 'agent_intent' : type === 'mediaTypeDetectorNode' ? 'media_type' : undefined,
            source_variable: type === 'textSplitterNode' ? 'transcripcion' : undefined,
            target_variable: type === 'textSplitterNode' ? 'split_words' : undefined,
            // AI Agent defaults
            confidence_threshold: type === 'aiAgentNode' ? 0.8 : undefined,
            enable_interception: type === 'aiAgentNode' ? true : undefined,
            generate_response: type === 'aiAgentNode' ? true : undefined,
            // Media Type Detector defaults
            audio_handle: type === 'mediaTypeDetectorNode' ? 'audio' : undefined,
            text_handle: type === 'mediaTypeDetectorNode' ? 'text' : undefined,
            
            // Callbacks
            onDelete: () => deleteNode(newNode.id),
            onChange: (text: string) => updateNodeData(newNode.id, { text }),
            onChangeQuestion: (q: string) => updateNodeData(newNode.id, { question: q }),
            onChangeVariable: (v: string) => updateNodeData(newNode.id, { variable: v }),
            onChangeOptions: (o: string[]) => updateNodeData(newNode.id, { options: o }),
            onChangeFlow: (f: string) => updateNodeData(newNode.id, { flowId: f }),
            onChangeAction: (a: string) => updateNodeData(newNode.id, { action: a }),
            onChangeProductVar: (v: string) => updateNodeData(newNode.id, { productVariable: v }),
            onChangeQtyVar: (v: string) => updateNodeData(newNode.id, { qtyVariable: v }),
            onChangeDetailVar: (v: string) => updateNodeData(newNode.id, { detailVariable: v }),
            onChangeDuration: (d: string) => updateNodeData(newNode.id, { duration: d }),
            onChangeShowTyping: (t: boolean) => updateNodeData(newNode.id, { showTyping: t }),
            onChangeReportType: (t: string) => updateNodeData(newNode.id, { reportType: t }),
            onChangePriority: (p: string) => updateNodeData(newNode.id, { priority: p }),
            onChangeMessage: (m: string) => updateNodeData(newNode.id, { message: m }),
            onChangeMediaUrl: (u: string) => updateNodeData(newNode.id, { mediaUrl: u }),
            onChangeCaption: (c: string) => updateNodeData(newNode.id, { caption: c }),
            onChangeMediaType: (t: string) => updateNodeData(newNode.id, { mediaType: t }),
            onChangeFileName: (n_name: string) => updateNodeData(newNode.id, { fileName: n_name }),
            onChangeMimeType: (m: string) => updateNodeData(newNode.id, { mimetype: m }),
            onChangePrompt: (p: string) => updateNodeData(newNode.id, { prompt: p }),
            onChangeSystemPrompt: (s: string) => updateNodeData(newNode.id, { systemPrompt: s }),
            onChangeTemperature: (t: number) => updateNodeData(newNode.id, { temperature: t }),
            onChangeSilent: (s: boolean) => updateNodeData(newNode.id, { silent: s }),
            onChangePossibleIntents: (i: string) => updateNodeData(newNode.id, { possible_intents: i }),
            onChangeFallbackMessage: (m: string) => updateNodeData(newNode.id, { fallback_message: m }),
            onChangeMaxRetries: (r: number) => updateNodeData(newNode.id, { max_retries: r }),
            onChangeContextVariables: (c: string[]) => updateNodeData(newNode.id, { context_variables: c }),
            onChangeKeywords: (k: any[]) => updateNodeData(newNode.id, { keywords: k }),
            onChangeCases: (c: any[]) => updateNodeData(newNode.id, { cases: c }),
            onChangeValue: (key: string, val: any) => updateNodeData(newNode.id, { [key]: val }),
        },
      };

      setNodes((nds) => nds.concat(newNode));
  }, [reactFlowInstance, setNodes, deleteNode, updateNodeData]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (typeof type === 'undefined' || !type) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNodeByType(type, position);
    },
    [reactFlowInstance, addNodeByType]
  );

  const handleSave = async () => {
    if (!reactFlowInstance) return;
    if (!activeAccountId) {
      toast.error('Seleccioná una cuenta de WhatsApp antes de guardar.');
      return;
    }
    const flow = reactFlowInstance.toObject();
    
    // Clean up nodes data before saving
    const cleanNodes = flow.nodes.map((n: any) => {
        const { 
            onChange, onChangeQuestion, onChangeVariable, onChangeValue, onChangeOptions, 
            onChangeSaveField, onChangeFlow, onDelete, onChangeAction, onChangeProductVar, 
            onChangeQtyVar, onChangeDetailVar, onChangeDuration, onChangeShowTyping, 
            onChangeReportType, onChangePriority, onChangeMessage, onChangeMediaUrl, 
            onChangeCaption, onChangeMediaType, onChangeFileName, onChangeMimeType, 
            onChangePrompt, onChangeSystemPrompt, onChangeTemperature, onChangeSilent, 
            onChangePossibleIntents, onChangeFallbackMessage, onChangeMaxRetries, 
            onChangeContextVariables, onChangeFailNodeId, onChangeQuery, onChangeKeywords, 
            onChangeCases, ...restData 
        } = n.data;
        return { ...n, data: restData };
    });

    try {
        if (currentFlowId) {
            // Update existing flow
            const data = await flowsApi.update(String(currentFlowId), {
                name: flowName,
                trigger_word: trigger,
                nodes: cleanNodes,
                edges: flow.edges,
                is_active: isActive
            });
            setCurrentFlowId(data.id);
        } else {
            // Create new flow
            const data = await flowsApi.create({
                account_id: activeAccountId!,
                name: flowName,
                trigger_word: trigger,
                nodes: cleanNodes,
                edges: flow.edges,
                is_active: isActive
            });
            setCurrentFlowId(data.id);
        }
        fetchFlows();
        toast.success('Flujo guardado correctamente');
    } catch (err: any) {
        toast.error('Error al guardar: ' + err.message);
    }
  };

  const handleExport = () => {
    if (!reactFlowInstance) return;
    const flow = reactFlowInstance.toObject();
    
    // Clean nodes data like we do for handleSave
    const cleanNodes = flow.nodes.map((n: any) => {
        const { 
            onChange, onChangeQuestion, onChangeVariable, onChangeValue, onChangeOptions, 
            onChangeSaveField, onChangeFlow, onDelete, onChangeAction, onChangeProductVar, 
            onChangeQtyVar, onChangeDetailVar, onChangeDuration, onChangeShowTyping, 
            onChangeReportType, onChangePriority, onChangeMessage, onChangeMediaUrl, 
            onChangeCaption, onChangeMediaType, onChangeFileName, onChangeMimeType, 
            onChangePrompt, onChangeSystemPrompt, onChangeTemperature, onChangeSilent, 
            onChangePossibleIntents, onChangeFallbackMessage, onChangeMaxRetries, 
            onChangeContextVariables, onChangeFailNodeId, onChangeQuery, ...restData 
        } = n.data;
        return { ...n, data: restData };
    });

    const exportData = {
        version: '1.0',
        name: flowName,
        trigger_word: trigger,
        is_active: isActive,
        nodes: cleanNodes,
        edges: flow.edges
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${flowName.replace(/\s+/g, '_')}_bot_flow.json`;
    link.click();
    toast.success('Flujo exportado correctamente');
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!json.nodes || !Array.isArray(json.nodes)) {
            throw new Error('El archivo no parece ser un flujo válido (faltan nodos)');
        }

        // Load into editor as a "New Flow" (unsaved)
        setCurrentFlowId(null);
        setFlowName(`${json.name || 'Importado'} (Copia)`);
        setTrigger(json.trigger_word || 'cambiame');
        setIsActive(json.is_active ?? true);
        
        const restoredNodes = prepareNodes(json.nodes);
        setNodes(restoredNodes);
        setEdges(json.edges || []);

        toast.success(`Flujo "${json.name}" importado con éxito. No olvides guardarlo.`);
      } catch (err: any) {
        toast.error('Error al importar: ' + err.message);
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  const handleDelete = async () => {
      if (!currentFlowId) return;
      
      const confirmDelete = window.confirm(`¿Estás seguro de que quieres eliminar el flujo "${flowName}"? Esta acción no se puede deshacer.`);
      if (!confirmDelete) return;

      try {
          await flowsApi.delete(String(currentFlowId));
          toast.success('Flujo eliminado correctamente');
          createNewFlow();
          fetchFlows();
      } catch (err: any) {
          console.error('Error deleting flow:', err);
          toast.error('Error al eliminar: ' + err.message);
      }
  };



  return (
    <div className="flex h-screen w-full">
      <ReactFlowProvider>
        <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden" ref={reactFlowWrapper}>
            {/* Header - Desktop */}
            <div className="hidden lg:flex h-16 bg-white border-b items-center justify-between px-4 z-10 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                        <label className="text-xs text-gray-500 font-semibold mb-1">Mis Flujos</label>
                        <select 
                            className="text-sm border-gray-300 rounded focus:ring-purple-500 py-1"
                            value={currentFlowId === null ? '' : (currentFlowId ?? '')}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                    createNewFlow();
                                } else {
                                    const flow = flows.find(f =>String(f.id) === String(val));
                                    if (flow) loadFlow(flow);
                                }
                            }}
                        >
                            <option value="">+ Nuevo Flujo</option>
                            {flows.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="h-8 w-px bg-gray-300 mx-2"></div>

                    <div className="flex flex-col">
                        <label className="text-xs text-gray-500 font-semibold mb-1">Nombre del Flujo</label>
                        <input 
                            className="font-bold text-sm border-gray-300 rounded focus:ring-purple-500 py-1 w-48"
                            value={flowName}
                            onChange={(e) => setFlowName(e.target.value)}
                        />
                    </div>
                    
                    <div className="flex flex-col">
                        <label className="text-xs text-gray-500 font-semibold mb-1">Palabra Clave</label>
                        <input 
                            className="text-sm border-gray-300 rounded focus:ring-purple-500 py-1 w-32 font-mono text-blue-600"
                            value={trigger}
                            onChange={(e) => setTrigger(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-4">
                     <label className="flex items-center cursor-pointer relative">
                        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="sr-only peer" />
                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                        <span className="ml-2 text-xs font-medium text-gray-900">Activo</span>
                    </label>

                    <div className="h-8 w-px bg-gray-200 mx-1"></div>

                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleExport}
                            title="Exportar archivo JSON"
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded transition"
                        >
                            <Download size={20} />
                        </button>
                        
                        <label className="p-2 text-gray-600 hover:bg-gray-100 rounded transition cursor-pointer">
                            <Upload size={20} />
                            <input 
                                type="file" 
                                accept=".json" 
                                className="hidden" 
                                onChange={handleImport}
                            />
                        </label>
                    </div>

                    <div className="h-8 w-px bg-gray-200 mx-1"></div>

                    {currentFlowId && (
                        <button 
                            onClick={handleDelete}
                            className="bg-red-50 text-red-600 px-4 py-2 rounded flex items-center gap-2 hover:bg-red-100 transition shadow-sm border border-red-200"
                        >
                            <Trash2 size={18} />
                            Eliminar
                        </button>
                    )}

                    <button
                        onClick={handleSave}
                        disabled={!activeAccountId}
                        title={!activeAccountId ? 'Seleccioná una cuenta para guardar' : 'Guardar'}
                        className="bg-green-600 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-green-700 transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-green-600"
                    >
                        <Save size={18} />
                        Guardar
                    </button>
                </div>
            </div>

            {/* Header - Mobile */}
            <div className="lg:hidden h-14 bg-[#6366f1] flex items-center justify-between px-4 z-20 shadow-md">
                <div className="flex items-center gap-3">
                    <button onClick={() => window.history.back()} className="text-white">
                        <ChevronLeft size={24} />
                    </button>
                    <div className="flex flex-col">
                        <span className="text-[10px] text-white/70 uppercase font-bold tracking-wider">Flujo Actual</span>
                        <h1 className="text-white font-bold text-sm truncate max-w-[150px]">{flowName}</h1>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSave}
                        disabled={!activeAccountId}
                        className="p-2 bg-white/20 text-white rounded-lg active:scale-95 transition disabled:opacity-40"
                    >
                        <Save size={20} />
                    </button>
                    <button 
                        onClick={() => setIsMobileMenuOpen(true)}
                        className="p-2 bg-white/20 text-white rounded-lg active:scale-95 transition"
                    >
                        <Menu size={20} />
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div className="flex-1 w-full h-full relative">
                <ReactFlow
                    key={currentFlowId || 'initial'}
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    nodeTypes={nodeTypes}
                    // @ts-ignore
                    connectOnDrop={false}
                    deleteKeyCode={['Backspace', 'Delete']}
                    defaultEdgeOptions={{
                        animated: true,
                        style: { strokeWidth: 2, stroke: '#6366f1' },
                    }}
                    onEdgeDoubleClick={(_event, edge) => {
                        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
                    }}
                    fitView
                    // Mobile adjustments for touch
                    paneMoveable={true}
                    zoomOnPinch={true}
                    zoomOnDoubleClick={false}
                >
                    <Controls className="hidden lg:block" />
                    <Background color="#aaa" gap={16} />
                </ReactFlow>

                {/* FAB - Mobile */}
                <button 
                    onClick={() => setIsNodeSelectorOpen(true)}
                    className="lg:hidden fixed bottom-6 right-6 w-14 h-14 bg-[#6366f1] text-white rounded-full shadow-xl flex items-center justify-center z-30 active:scale-90 transition-transform"
                >
                    <Plus size={28} />
                </button>

                {/* Mobile Flow Management Drawer */}
                {isMobileMenuOpen && (
                    <div className="fixed inset-0 z-[110] bg-black/50 animate-in fade-in duration-300">
                        <div className="absolute inset-y-0 right-0 w-[80%] max-w-sm bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                            <div className="p-4 border-b flex items-center justify-between bg-gray-50">
                                <h3 className="font-bold text-gray-800">Ajustes de Flujo</h3>
                                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-gray-200 rounded-full">
                                    <X size={24} />
                                </button>
                            </div>
                            
                            <div className="p-4 flex-1 overflow-y-auto space-y-6">
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-gray-500 font-bold uppercase">Nombre</label>
                                        <input 
                                            className="w-full border-gray-300 rounded-xl p-3 bg-gray-50"
                                            value={flowName}
                                            onChange={(e) => setFlowName(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-gray-500 font-bold uppercase">Palabra Clave</label>
                                        <input 
                                            className="w-full border-gray-300 rounded-xl p-3 bg-gray-50 font-mono text-blue-600"
                                            value={trigger}
                                            onChange={(e) => setTrigger(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                        <span className="text-sm font-medium text-gray-700">Estado Activo</span>
                                        <label className="flex items-center cursor-pointer relative">
                                            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="sr-only peer" />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                                        </label>
                                    </div>
                                </div>

                                <div className="pt-4 border-t space-y-3">
                                    <label className="text-xs text-gray-500 font-bold uppercase block mb-2">Cambiar de Flujo</label>
                                    <div className="grid grid-cols-1 gap-2">
                                        <button 
                                            onClick={() => { createNewFlow(); setIsMobileMenuOpen(false); }}
                                            className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 text-blue-600 font-medium text-sm hover:bg-blue-50"
                                        >
                                            <Plus size={18} /> Nuevo Flujo
                                        </button>
                                        {flows.map(f => (
                                            <button 
                                                key={f.id}
                                                onClick={() => { loadFlow(f); setIsMobileMenuOpen(false); }}
                                                className={`flex items-center justify-between p-3 rounded-xl border ${String(f.id) === String(currentFlowId) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-100 text-gray-700'}`}
                                            >
                                                <span className="text-sm font-medium truncate">{f.name}</span>
                                                <div className={`w-2 h-2 rounded-full ${f.is_active ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-4 border-t grid grid-cols-2 gap-3">
                                    <button 
                                        onClick={handleExport}
                                        className="flex flex-col items-center justify-center gap-2 p-4 bg-gray-50 rounded-2xl text-gray-600 active:bg-gray-100"
                                    >
                                        <Download size={20} />
                                        <span className="text-xs font-bold">Exportar</span>
                                    </button>
                                    <label className="flex flex-col items-center justify-center gap-2 p-4 bg-gray-50 rounded-2xl text-gray-600 active:bg-gray-100 cursor-pointer">
                                        <Upload size={20} />
                                        <span className="text-xs font-bold">Importar</span>
                                        <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                                    </label>
                                </div>

                                {currentFlowId && (
                                    <button 
                                        onClick={() => { handleDelete(); setIsMobileMenuOpen(false); }}
                                        className="w-full p-4 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center gap-2 font-bold border border-red-100 mt-4"
                                    >
                                        <Trash2 size={18} />
                                        Eliminar Flujo
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Mobile Node Selector */}
                <MobileNodeSelector 
                    isOpen={isNodeSelectorOpen} 
                    onClose={() => setIsNodeSelectorOpen(false)} 
                    onSelect={(type) => addNodeByType(type)} 
                />
            </div>
        </div>
        <Sidebar />
      </ReactFlowProvider>
    </div>
  );
}
