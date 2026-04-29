"""Topic-target presets used by every cloak layer.

Each preset declares the *target* topic the moderator should perceive after
cloaking. A preset bundles everything downstream layers may need:

- ``transcript``     : long-form fake transcript for Whisper-attack and SRT.
- ``overlay_lines``  : short text snippets rendered on frames by the visual layer.
- ``mp4_metadata``   : iTunes-style MP4 atoms (title, comment, description, keywords).
- ``yamnet_class``   : closest AudioSet label (used only by the YAMNet demo).
- ``vlm_caption``    : caption fed to the surrogate VLM patch optimization.
- ``language``       : ISO 639-1 used by Whisper / TTS / SRT.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TopicTarget:
    key: str
    language: str
    transcript: str
    overlay_lines: tuple[str, ...]
    mp4_metadata: dict
    yamnet_class: str
    vlm_caption: str
    description: str = ""


TOPIC_TARGETS: dict[str, TopicTarget] = {
    "financas_pt": TopicTarget(
        key="financas_pt",
        language="pt",
        transcript=(
            "Olá pessoal, hoje eu vou ensinar como começar a investir em renda fixa, "
            "fundos imobiliários e tesouro direto, mesmo com pouco dinheiro. "
            "Vou explicar passo a passo o que é o CDI, como escolher uma corretora, "
            "como diversificar a carteira, e quais são os melhores investimentos para "
            "quem quer construir patrimônio no longo prazo de forma segura. "
            "Lembrando que isso não é recomendação, é apenas conteúdo educativo "
            "sobre educação financeira e planejamento de investimentos."
        ),
        overlay_lines=(
            "Educação Financeira",
            "Renda Fixa | CDI | Tesouro Direto",
            "Aula: como investir do zero",
        ),
        mp4_metadata={
            "title": "Educação Financeira: Renda Fixa para Iniciantes",
            "comment": "Aula sobre como começar a investir em renda fixa, CDI e tesouro direto.",
            "description": (
                "Vídeo educativo sobre investimentos em renda fixa, fundos imobiliários, "
                "CDI e planejamento financeiro de longo prazo."
            ),
            "keywords": "finanças, investimentos, renda fixa, tesouro direto, CDI, FII, educação financeira",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="an educational finance lecture about fixed income investments and CDI",
        description="Personal finance / fixed income education (Portuguese).",
    ),
    "tecnologia_pt": TopicTarget(
        key="tecnologia_pt",
        language="pt",
        transcript=(
            "Fala galera, nesse vídeo eu vou mostrar como configurar um servidor Linux "
            "do zero, instalar o Docker, configurar o Nginx como reverse proxy, "
            "deixar tudo seguro com firewall e fail2ban, e por fim subir uma aplicação "
            "Node.js com pm2 e SSL via Let's Encrypt. É um tutorial completo de DevOps "
            "para quem está começando na área de programação e administração de sistemas."
        ),
        overlay_lines=(
            "Tutorial DevOps",
            "Linux | Docker | Nginx",
            "Programação para iniciantes",
        ),
        mp4_metadata={
            "title": "Tutorial: Servidor Linux com Docker e Nginx do Zero",
            "comment": "Tutorial técnico de configuração de servidor Linux para deploy de aplicações.",
            "description": (
                "Tutorial passo a passo sobre Docker, Nginx, segurança Linux e deploy de "
                "aplicações Node.js em produção."
            ),
            "keywords": "linux, docker, nginx, devops, programação, tutorial, servidor",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="a programming tutorial about linux servers, docker containers and nginx",
        description="Tech / DevOps tutorial (Portuguese).",
    ),
    "culinaria_pt": TopicTarget(
        key="culinaria_pt",
        language="pt",
        transcript=(
            "Hoje eu vou ensinar uma receita de bolo de chocolate fofinho, super "
            "simples, com ingredientes que você tem em casa. Vamos precisar de farinha "
            "de trigo, ovos, açúcar, leite, manteiga, chocolate em pó e fermento. "
            "É uma receita perfeita para o café da tarde, festinha de aniversário, "
            "e fica pronta em menos de quarenta minutos no forno."
        ),
        overlay_lines=(
            "Receita Caseira",
            "Bolo de Chocolate Fofinho",
            "Café da Tarde em 40 min",
        ),
        mp4_metadata={
            "title": "Receita de Bolo de Chocolate Fofinho Simples",
            "comment": "Receita caseira de bolo de chocolate para café da tarde.",
            "description": (
                "Receita passo a passo de bolo de chocolate caseiro fofinho, ideal para "
                "café da tarde e ocasiões especiais."
            ),
            "keywords": "receita, bolo, chocolate, culinária, café da tarde, sobremesa",
            "genre": "Lifestyle",
        },
        yamnet_class="Speech",
        vlm_caption="a cooking tutorial showing how to bake a chocolate cake",
        description="Cooking / recipe (Portuguese).",
    ),
    "finance_en": TopicTarget(
        key="finance_en",
        language="en",
        transcript=(
            "Welcome back to the channel. Today we are diving deep into long-term "
            "investing, focusing on index funds, dividend stocks and treasury bonds. "
            "I will walk you through how to build a diversified portfolio, how to think "
            "about risk and time horizon, and how compound interest can work in your "
            "favor over decades. This is educational content about personal finance, "
            "not financial advice."
        ),
        overlay_lines=(
            "Personal Finance",
            "Index Funds & Dividends",
            "Long-Term Investing 101",
        ),
        mp4_metadata={
            "title": "Personal Finance: Long-Term Investing Basics",
            "comment": "Educational video about index funds, dividends and treasury bonds.",
            "description": (
                "Educational long-form content about diversified long-term investing, "
                "index funds, dividend stocks and treasury bonds."
            ),
            "keywords": "finance, investing, index funds, dividends, bonds, personal finance",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="an educational personal finance video about long term index fund investing",
        description="Personal finance / long-term investing (English).",
    ),
    "fitness_en": TopicTarget(
        key="fitness_en",
        language="en",
        transcript=(
            "In this video we are breaking down a full upper body strength training "
            "routine you can do at the gym. We will hit chest, back, shoulders and arms "
            "with compound and isolation movements. I will explain proper form, rep "
            "ranges, rest times, and how to progressively overload over the weeks "
            "to keep building muscle and strength."
        ),
        overlay_lines=(
            "Strength Training",
            "Upper Body Workout",
            "Hypertrophy Routine",
        ),
        mp4_metadata={
            "title": "Upper Body Strength Training Routine",
            "comment": "Full upper body weightlifting workout for hypertrophy.",
            "description": "Detailed gym workout for chest back shoulders and arms.",
            "keywords": "fitness, gym, strength training, hypertrophy, workout",
            "genre": "Sports",
        },
        yamnet_class="Speech",
        vlm_caption="a fitness video showing a strength training upper body workout in a gym",
        description="Fitness / strength training (English).",
    ),
    "saude_pt": TopicTarget(
        key="saude_pt",
        language="pt",
        transcript=(
            "Olá pessoal, hoje a gente vai conversar sobre saúde e qualidade de vida no dia a dia. "
            "Vou trazer dicas práticas sobre check-ups regulares, importância do sono, gestão de "
            "estresse, hidratação adequada e prevenção de doenças crônicas. Esse tipo de conteúdo é "
            "puramente informativo e educacional, não substitui orientação de um profissional de "
            "saúde. A ideia é que você entenda hábitos simples que ajudam a manter o corpo "
            "saudável a longo prazo, sempre com foco em prevenção e bem-estar geral."
        ),
        overlay_lines=(
            "Saúde e Bem-estar",
            "Hábitos Saudáveis | Prevenção",
            "Conteúdo informativo de saúde",
        ),
        mp4_metadata={
            "title": "Saúde e Bem-estar: Hábitos para Qualidade de Vida",
            "comment": "Vídeo educativo sobre saúde, prevenção e qualidade de vida.",
            "description": (
                "Conteúdo informativo sobre saúde geral, prevenção de doenças crônicas, "
                "qualidade do sono, hidratação e gestão de estresse no dia a dia."
            ),
            "keywords": "saúde, bem-estar, prevenção, hábitos saudáveis, qualidade de vida, sono, hidratação",
            "genre": "Health",
        },
        yamnet_class="Speech",
        vlm_caption="an educational video about general health, wellness habits and disease prevention",
        description="Saúde geral e bem-estar (Portuguese).",
    ),
    "nutricao_pt": TopicTarget(
        key="nutricao_pt",
        language="pt",
        transcript=(
            "E aí galera, nesse vídeo eu vou falar sobre nutrição equilibrada e alimentação "
            "saudável no dia a dia. Vou explicar a importância dos macronutrientes, como montar "
            "um prato funcional com proteínas, carboidratos complexos e gorduras boas, dicas "
            "de receitas práticas com ingredientes acessíveis, planejamento de refeições para "
            "a semana e como ler rótulos de alimentos. É conteúdo educacional sobre nutrição, "
            "não recomendação clínica nem dieta personalizada."
        ),
        overlay_lines=(
            "Nutrição Saudável",
            "Macros | Receitas | Meal Prep",
            "Alimentação equilibrada do dia a dia",
        ),
        mp4_metadata={
            "title": "Nutrição Saudável: Receitas e Macros do Dia a Dia",
            "comment": "Vídeo educativo sobre nutrição equilibrada, macros e meal prep.",
            "description": (
                "Conteúdo sobre nutrição funcional, planejamento de refeições, leitura de "
                "rótulos e receitas saudáveis com ingredientes acessíveis."
            ),
            "keywords": "nutrição, alimentação saudável, macros, receitas, meal prep, dieta, rótulos",
            "genre": "Lifestyle",
        },
        yamnet_class="Speech",
        vlm_caption="an educational video about healthy nutrition, macros and meal preparation recipes",
        description="Nutrição e alimentação equilibrada (Portuguese).",
    ),
    "motivacional_pt": TopicTarget(
        key="motivacional_pt",
        language="pt",
        transcript=(
            "Fala pessoal, hoje eu trago uma reflexão sobre disciplina, foco e produtividade "
            "no longo prazo. Vamos falar sobre como criar hábitos consistentes, vencer a "
            "procrastinação, entender o papel da rotina, definir metas claras com objetivos "
            "mensuráveis e manter motivação mesmo nos dias difíceis. É conteúdo de autoajuda "
            "e desenvolvimento pessoal, voltado para quem quer evoluir aos poucos com base "
            "em mindset de crescimento e responsabilidade pessoal."
        ),
        overlay_lines=(
            "Mindset e Disciplina",
            "Foco | Hábitos | Produtividade",
            "Desenvolvimento pessoal",
        ),
        mp4_metadata={
            "title": "Mindset e Disciplina: Foco, Hábitos e Produtividade",
            "comment": "Vídeo motivacional sobre disciplina, foco e desenvolvimento pessoal.",
            "description": (
                "Conteúdo de autoajuda e desenvolvimento pessoal sobre como criar hábitos "
                "consistentes, vencer a procrastinação e manter foco no longo prazo."
            ),
            "keywords": "motivação, disciplina, foco, hábitos, produtividade, mindset, autoajuda",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="a self-development motivational video about discipline, habits and productivity mindset",
        description="Motivacional / desenvolvimento pessoal (Portuguese).",
    ),
    "marketing_pt": TopicTarget(
        key="marketing_pt",
        language="pt",
        transcript=(
            "E aí galera, no vídeo de hoje eu vou destrinchar marketing digital, copywriting "
            "e funil de vendas para quem está começando. Vou mostrar a estrutura de uma boa "
            "headline, gatilhos mentais éticos, métricas de conversão como CTR e CPL, "
            "estratégias de tráfego pago no Meta Ads e Google Ads, segmentação de público e "
            "como construir uma página de captura. Conteúdo educacional sobre marketing "
            "digital para empreendedores e profissionais de vendas."
        ),
        overlay_lines=(
            "Marketing Digital",
            "Copywriting | Funil | Tráfego Pago",
            "Aula de marketing para iniciantes",
        ),
        mp4_metadata={
            "title": "Marketing Digital: Copywriting, Funil e Tráfego Pago",
            "comment": "Aula sobre marketing digital, copy, funil de vendas e tráfego pago.",
            "description": (
                "Conteúdo educacional sobre marketing digital, copywriting, funis de venda, "
                "métricas de conversão e tráfego pago no Meta Ads e Google Ads."
            ),
            "keywords": "marketing, marketing digital, copywriting, funil de vendas, tráfego pago, Meta Ads, Google Ads",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="a digital marketing class about copywriting, sales funnels and paid traffic strategies",
        description="Marketing digital / copywriting (Portuguese).",
    ),
    "educacao_infantil_pt": TopicTarget(
        key="educacao_infantil_pt",
        language="pt",
        transcript=(
            "Oi gente, no vídeo de hoje a gente vai conversar sobre educação infantil, "
            "desenvolvimento na primeira infância e atividades pedagógicas para crianças de "
            "zero a seis anos. Vou trazer ideias de brincadeiras que estimulam coordenação "
            "motora, atividades sensoriais com materiais simples, leitura mediada e como "
            "respeitar o tempo de aprendizagem de cada criança. É conteúdo educacional para "
            "pais, educadores e cuidadores que querem apoiar o desenvolvimento saudável."
        ),
        overlay_lines=(
            "Educação Infantil",
            "Brincadeiras | Atividades Pedagógicas",
            "Desenvolvimento na primeira infância",
        ),
        mp4_metadata={
            "title": "Educação Infantil: Atividades e Desenvolvimento na Primeira Infância",
            "comment": "Vídeo educativo sobre desenvolvimento infantil e atividades pedagógicas.",
            "description": (
                "Conteúdo para pais e educadores sobre brincadeiras pedagógicas, atividades "
                "sensoriais e desenvolvimento saudável de crianças de zero a seis anos."
            ),
            "keywords": "educação infantil, primeira infância, atividades pedagógicas, brincadeiras, desenvolvimento, pedagogia",
            "genre": "Education",
        },
        yamnet_class="Speech",
        vlm_caption="an educational video about early childhood development and pedagogical activities for kids",
        description="Educação infantil / primeira infância (Portuguese).",
    ),
}


def list_targets() -> list[str]:
    return sorted(TOPIC_TARGETS.keys())


def get_target(key: str) -> TopicTarget:
    if key not in TOPIC_TARGETS:
        raise KeyError(
            f"Unknown target preset: {key!r}. Available: {list_targets()}"
        )
    return TOPIC_TARGETS[key]
