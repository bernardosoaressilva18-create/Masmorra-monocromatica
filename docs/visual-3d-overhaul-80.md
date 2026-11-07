# Plano de 80 melhorias visuais — O Último Legado

Escopo: versão Web / Three.js, partindo da branch `feature/loot-system`.
Este documento organiza 20 melhorias por área. Ele não afirma que todos os 80 itens já foram implementados; os itens marcados como “base nesta rodada” são as alterações de código incluídas nesta branch.

## 1. Gráficos — 20 melhorias
1. Perfis de exposição para gráficos baixos, equilibrados e altos. — base nesta rodada
2. Resolução procedural do piso adequada à qualidade escolhida. — base nesta rodada
3. Densidade de riscos escalada com a resolução da textura. — base nesta rodada
4. Densidade de fissuras escalada com a resolução. — base nesta rodada
5. Microdetalhes do piso escalados com a resolução. — base nesta rodada
6. Repetição da textura por perfil gráfico. — base nesta rodada
7. Intensidade de relevo do piso por perfil. — base nesta rodada
8. Intensidade de relevo das paredes por perfil. — base nesta rodada
9. Anisotropia reduzida em celulares de entrada. — base nesta rodada
10. Partículas ambientes com densidade por aparelho e preset. — base nesta rodada
11. Paleta de luz própria para cada mundo.
12. Contraste de materiais para separar personagem, monstros e cenário.
13. Emissão de runas calibrada para não estourar as cores.
14. Portais com núcleo, borda e partículas em camadas.
15. Efeitos de magia com cores mais consistentes por classe.
16. Melhor legibilidade visual das áreas de perigo dos chefes.
17. Sombras de contato consistentes em personagens e monstros.
18. Texturas de pedra, terra, vegetação e lava com identidade própria.
19. Névoa ajustada à distância e ao bioma.
20. Passagem suave entre presets gráficos sem reiniciar a partida.

## 2. Modelagem e 3D — 20 melhorias
1. Tronco com cintura e ombros mais definidos. — base nesta rodada
2. Pernas com formato afunilado em vez de cápsulas uniformes. — base nesta rodada
3. Joelheiras facetadas. — base nesta rodada
4. Pescoço conectando cabeça e tronco. — base nesta rodada
5. Gola e emblema peitoral para dar leitura de volume. — base nesta rodada
6. Braços com antebraços articulados. — base nesta rodada
7. Luvas e proteção de pulso. — base nesta rodada
8. Ombreiras angulares em vez de volumes esféricos. — base nesta rodada
9. Capacete do cavaleiro com faces mais definidas. — base nesta rodada
10. Silhueta geral do herói ligeiramente mais destacada. — base nesta rodada
11. Silhuetas próprias para cada classe.
12. Roupas e capas com painéis separados.
13. Armas com proporção e encaixe visual melhorados.
14. Escudos com relevo e bordas mais claras.
15. Mãos e pés com formas próprias por classe.
16. Criaturas com articulações e volumes mais distintos.
17. Chefes com proporções e peças de armadura próprias.
18. Detalhes de rosto legíveis à distância de jogo.
19. Ajuste de LOD para modelos distantes.
20. Revisão de escala para evitar personagens pequenos no enquadramento.

## 3. Desempenho e lag — 20 melhorias
1. Limite de renderização equilibrado por qualidade e orientação do celular. — base nesta rodada
2. Materiais Standard mais leves para armaduras em celulares. — base nesta rodada
3. Anisotropia limitada por hardware. — base nesta rodada
4. Quantidade de partículas ambiente limitada por preset. — base nesta rodada
5. Tier visual adaptativo a quedas sustentadas de FPS. — base nesta rodada
6. Redução adicional da resolução quando o FPS cai. — base nesta rodada
7. Animações cosméticas simplificadas para aliados distantes. — base nesta rodada
8. Vetores temporários reutilizados no movimento do jogador. — base nesta rodada
9. Barras de vida orientadas à câmera em frequência limitada. — base nesta rodada
10. Pausa do loop e do áudio quando a aba fica em segundo plano (já existente; manter).
11. Limite de efeitos simultâneos de magia.
12. Descarte previsível de geometrias e materiais temporários.
13. LOD de monstros fora da área visível.
14. Redução de animação secundária em monstros distantes.
15. Atualização de elementos decorativos em intervalos controlados.
16. Reutilização de geometrias repetidas.
17. Reutilização de materiais sem descarte prematuro.
18. Redução de chamadas DOM repetitivas durante o jogo.
19. Carregamento progressivo de detalhes não essenciais.
20. Testes de FPS e memória nos perfis de celular fraco, médio e forte.

## 4. Personagem — 20 melhorias
1. Proporção do torso com leitura mais humanoide. — base nesta rodada
2. Separação visual entre coxa, joelho e bota. — base nesta rodada
3. Articulação de cotovelo para melhorar a pose dos braços. — base nesta rodada
4. Luvas com volume definido. — base nesta rodada
5. Ombreiras com contorno facetado. — base nesta rodada
6. Cabeça do cavaleiro com capacete menos esférico. — base nesta rodada
7. Pescoço e gola integrando as partes do corpo. — base nesta rodada
8. Emblema no peito para reforçar a identidade. — base nesta rodada
9. Anel de seleção mais legível. — base nesta rodada
10. Escala geral um pouco maior para destacar o jogador. — base nesta rodada
11. Silhueta distinta para mago, arqueiro, cavaleiro e demais classes.
12. Capas com movimento ligado à velocidade.
13. Armas alinhadas visualmente às mãos.
14. Escudo acompanhando a pose do cavaleiro.
15. Postura de descanso com respiração sutil.
16. Animação de ataque com preparação, impacto e recuperação.
17. Reação visual ao receber dano.
18. Orientação da cabeça e do tronco acompanhando a ação.
19. Barra de vida com contraste e posição consistentes.
20. Identidade de cor e brilho por classe e skin.

## Notas de implementação
- Esta rodada altera somente código do cliente 3D e documentação.
- A branch de produção do Render continua sendo `feature/loot-system`; esta branch separada não publica automaticamente a atualização no jogo ao vivo.
- É necessário rodar os testes de sintaxe e testar no Redmi 13C / Moto G22 antes de integrar.
