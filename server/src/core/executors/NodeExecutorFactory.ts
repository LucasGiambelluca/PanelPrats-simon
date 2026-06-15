import { NodeExecutor } from './types';
import { StartNodeExecutor } from './StartNodeExecutor';
import { MessageExecutor } from './MessageExecutor';
import { QuestionExecutor } from './QuestionExecutor';
import { ConditionExecutor } from './ConditionExecutor';
import { SwitchExecutor } from './SwitchExecutor';
import { ArraySwitchExecutor } from './ArraySwitchExecutor';
import { KeywordExecutor } from './KeywordExecutor';
import { FlowLinkExecutor } from './FlowLinkExecutor';
import { TimerExecutor } from './TimerExecutor';
import { PollExecutor } from './PollExecutor';
import { MediaUploadExecutor } from './MediaUploadExecutor';
import { SendMediaExecutor } from './SendMediaExecutor';
import { DocumentExecutor } from './DocumentExecutor';
import { AudioToTextExecutor } from './AudioToTextExecutor';
import { MediaTypeDetectorExecutor } from './MediaTypeDetectorExecutor';
import { HandoverExecutor } from './HandoverExecutor';
import { ThreadManagerExecutor } from './ThreadManagerExecutor';
import { WebhookExecutor } from './WebhookExecutor';
import { ReportExecutor } from './ReportExecutor';
import { BusinessHoursExecutor } from './BusinessHoursExecutor';
import { GroqExecutor } from './GroqExecutor';
import { IntentResolverExecutor } from './IntentResolverExecutor';
import { BufferMemoryExecutor } from './BufferMemoryExecutor';
import { TextSplitterExecutor } from './TextSplitterExecutor';
import { AIAgentExecutor } from './AIAgentExecutor'; // omitir si Task 9 = B

class NodeExecutorFactory {
  private executors = new Map<string, NodeExecutor>();
  constructor() { this.registerAll(); }
  private register(type: string, ex: NodeExecutor) { this.executors.set(type, ex); }

  private registerAll() {
    this.register('messageNode', new MessageExecutor());
    this.register('questionNode', new QuestionExecutor());
    this.register('conditionNode', new ConditionExecutor());
    this.register('switchNode', new SwitchExecutor());
    this.register('arraySwitchNode', new ArraySwitchExecutor());
    this.register('keywordNode', new KeywordExecutor());
    this.register('flowLinkNode', new FlowLinkExecutor());
    this.register('timerNode', new TimerExecutor());
    this.register('pollNode', new PollExecutor());
    this.register('mediaUploadNode', new MediaUploadExecutor());
    this.register('sendMediaNode', new SendMediaExecutor());
    this.register('documentNode', new DocumentExecutor());
    this.register('audioTranscriberNode', new AudioToTextExecutor());
    this.register('audioToTextNode', new AudioToTextExecutor());
    this.register('mediaTypeDetectorNode', new MediaTypeDetectorExecutor());
    this.register('mediaDetectorNode', new MediaTypeDetectorExecutor());
    this.register('handoverNode', new HandoverExecutor());
    this.register('threadNode', new ThreadManagerExecutor());
    this.register('webhookNode', new WebhookExecutor());
    this.register('reportNode', new ReportExecutor());
    this.register('businessHoursNode', new BusinessHoursExecutor());
    this.register('groqNode', new GroqExecutor());
    this.register('intentResolverNode', new IntentResolverExecutor());
    this.register('bufferMemoryNode', new BufferMemoryExecutor());
    this.register('textSplitterNode', new TextSplitterExecutor());
    this.register('aiAgentNode', new AIAgentExecutor()); // omitir si Task 9 = B
    // Legacy
    this.register('input', new StartNodeExecutor());
    this.register('start', new StartNodeExecutor());
    this.register('send_message', new MessageExecutor());
    this.register('wait_input', new QuestionExecutor());
  }

  getExecutor(type: string): NodeExecutor {
    const ex = this.executors.get(type);
    if (!ex) {
      console.warn(`[NodeExecutorFactory] Sin executor para "${type}": no-op pass-through.`);
      const noop: NodeExecutor = { async execute() { return { messages: [], wait_for_input: false }; } };
      this.executors.set(type, noop);
      return noop;
    }
    return ex;
  }
}

export const nodeExecutorFactory = new NodeExecutorFactory();
