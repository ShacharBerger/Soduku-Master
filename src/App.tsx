import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RefreshCw, Music, Volume2, VolumeX, AlertCircle, CheckCircle2, XCircle, Timer, Lightbulb, Save, Download } from 'lucide-react';
import confetti from 'canvas-confetti';
import { GoogleGenAI, Modality } from "@google/genai";

// --- Sudoku Logic ---

type Grid = (number | null)[][];

const isValid = (grid: Grid, row: number, col: number, num: number): boolean => {
  for (let x = 0; x < 9; x++) if (grid[row][x] === num) return false;
  for (let x = 0; x < 9; x++) if (grid[x][col] === num) return false;
  let startRow = row - (row % 3), startCol = col - (col % 3);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (grid[i + startRow][j + startCol] === num) return false;
  return true;
};

const solveSudoku = (grid: Grid): boolean => {
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      if (grid[row][col] === null) {
        const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
        for (let num of nums) {
          if (isValid(grid, row, col, num)) {
            grid[row][col] = num;
            if (solveSudoku(grid)) return true;
            grid[row][col] = null;
          }
        }
        return false;
      }
    }
  }
  return true;
};

const generateSudoku = (difficulty: 'Easy' | 'Medium' | 'Hard'): { initial: Grid, solution: Grid } => {
  const solution: Grid = Array(9).fill(null).map(() => Array(9).fill(null));
  solveSudoku(solution);
  
  const initial: Grid = solution.map(row => [...row]);
  let attempts = difficulty === 'Easy' ? 30 : difficulty === 'Medium' ? 45 : 55;
  
  while (attempts > 0) {
    let row = Math.floor(Math.random() * 9);
    let col = Math.floor(Math.random() * 9);
    if (initial[row][col] !== null) {
      initial[row][col] = null;
      attempts--;
    }
  }
  
  return { initial, solution: solution as number[][] };
};

// --- Components ---

const MusicPlayer = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const generateMusic = async () => {
    if (audioUrl) return;
    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: "Generate a 30-second pleasant, relaxing, lo-fi background track for a puzzle game. No lyrics, just soft piano and ambient beats.",
      });

      let audioBase64 = "";
      let mimeType = "audio/wav";

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioBase64 += part.inlineData.data;
          }
        }
      }

      if (audioBase64) {
        const binary = atob(audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
      }
    } catch (error) {
      console.error("Failed to generate music:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const togglePlay = () => {
    if (!audioUrl) {
      generateMusic();
      setIsPlaying(true);
    } else {
      if (isPlaying) {
        audioRef.current?.pause();
      } else {
        audioRef.current?.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={togglePlay}
        disabled={isLoading}
        className={`p-3 rounded-full shadow-lg transition-all duration-300 ${
          isPlaying ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600'
        } hover:scale-110 active:scale-95 disabled:opacity-50`}
      >
        {isLoading ? (
          <RefreshCw className="w-6 h-6 animate-spin" />
        ) : isPlaying ? (
          <Volume2 className="w-6 h-6" />
        ) : (
          <VolumeX className="w-6 h-6" />
        )}
      </button>
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          loop
          autoPlay={isPlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}
    </div>
  );
};

export default function App() {
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Easy');
  const [grid, setGrid] = useState<Grid>([]);
  const [initialGrid, setInitialGrid] = useState<Grid>([]);
  const [solution, setSolution] = useState<Grid>([]);
  const [selected, setSelected] = useState<{ r: number, c: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [gameOver, setGameOver] = useState<'won' | 'lost' | null>(null);
  const [remaining, setRemaining] = useState<Record<number, number>>({});
  const [time, setTime] = useState(0);
  const [bestTimes, setBestTimes] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('sudoku-best-times');
    return saved ? JSON.parse(saved) : { Easy: Infinity, Medium: Infinity, Hard: Infinity };
  });
  const [hintsUsed, setHintsUsed] = useState(0);
  const MAX_HINTS = 3;

  const formatTime = (seconds: number) => {
    if (seconds === Infinity) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const saveGame = () => {
    const gameState = {
      grid,
      initialGrid,
      solution,
      difficulty,
      mistakes,
      time,
      hintsUsed
    };
    localStorage.setItem('sudoku-save-game', JSON.stringify(gameState));
    alert('Game saved successfully!');
  };

  const loadGame = () => {
    const saved = localStorage.getItem('sudoku-save-game');
    if (saved) {
      const state = JSON.parse(saved);
      setGrid(state.grid);
      setInitialGrid(state.initialGrid);
      setSolution(state.solution);
      setDifficulty(state.difficulty);
      setMistakes(state.mistakes);
      setTime(state.time);
      setHintsUsed(state.hintsUsed);
      setGameOver(null);
      setSelected(null);
      updateRemaining(state.grid);
    } else {
      alert('No saved game found.');
    }
  };

  const getHint = () => {
    if (hintsUsed >= MAX_HINTS || gameOver) return;

    const emptyCells: { r: number, c: number }[] = [];
    grid.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell === null) emptyCells.push({ r, c });
      });
    });

    if (emptyCells.length > 0) {
      const randomCell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
      const correctNum = solution[randomCell.r][randomCell.c];
      
      const newGrid = [...grid];
      newGrid[randomCell.r][randomCell.c] = correctNum;
      setGrid(newGrid);
      setHintsUsed(hintsUsed + 1);
      updateRemaining(newGrid);

      // Check win after hint
      if (newGrid.every((row, ri) => row.every((cell, ci) => cell === solution[ri][ci]))) {
        setGameOver('won');
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    }
  };

  const startNewGame = useCallback((diff: 'Easy' | 'Medium' | 'Hard' = difficulty) => {
    const { initial, solution } = generateSudoku(diff);
    setGrid(initial.map(row => [...row]));
    setInitialGrid(initial.map(row => [...row]));
    setSolution(solution);
    setMistakes(0);
    setGameOver(null);
    setSelected(null);
    setTime(0);
    setHintsUsed(0);
    updateRemaining(initial);
  }, [difficulty]);

  const updateRemaining = (currentGrid: Grid) => {
    const counts: Record<number, number> = {};
    for (let i = 1; i <= 9; i++) counts[i] = 9;
    currentGrid.forEach(row => {
      row.forEach(cell => {
        if (cell !== null) counts[cell]--;
      });
    });
    setRemaining(counts);
  };

  useEffect(() => {
    startNewGame();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (!gameOver) {
      interval = setInterval(() => {
        setTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameOver]);

  useEffect(() => {
    if (gameOver === 'won') {
      if (time < bestTimes[difficulty]) {
        const newBestTimes = { ...bestTimes, [difficulty]: time };
        setBestTimes(newBestTimes);
        localStorage.setItem('sudoku-best-times', JSON.stringify(newBestTimes));
      }
    }
  }, [gameOver, time, difficulty, bestTimes]);

  const handleCellClick = (r: number, c: number) => {
    if (gameOver || initialGrid[r][c] !== null) return;
    setSelected({ r, c });
  };

  const handleNumberInput = (num: number) => {
    if (!selected || gameOver || initialGrid[selected.r][selected.c] !== null) return;

    const { r, c } = selected;
    if (solution[r][c] === num) {
      const newGrid = [...grid];
      newGrid[r][c] = num;
      setGrid(newGrid);
      updateRemaining(newGrid);
      
      // Check win
      if (newGrid.every((row, ri) => row.every((cell, ci) => cell === solution[ri][ci]))) {
        setGameOver('won');
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 }
        });
      }
    } else {
      const newMistakes = mistakes + 1;
      setMistakes(newMistakes);
      if (newMistakes >= 3) {
        setGameOver('lost');
      }
    }
  };

  const isRelated = (r: number, c: number) => {
    if (!selected) return false;
    return r === selected.r || c === selected.c || 
           (Math.floor(r / 3) === Math.floor(selected.r / 3) && 
            Math.floor(c / 3) === Math.floor(selected.c / 3));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans text-slate-800">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-6 md:p-8"
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-indigo-900 tracking-tight">Sudoku Master</h1>
            <div className="flex gap-2 mt-2">
              {(['Easy', 'Medium', 'Hard'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => { setDifficulty(d); startNewGame(d); }}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                    difficulty === d 
                      ? 'bg-indigo-600 text-white shadow-md' 
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-3 justify-end mb-1">
              <div className="flex items-center gap-1 text-slate-500 text-sm font-medium">
                <Timer className="w-4 h-4" />
                <span>{formatTime(time)}</span>
              </div>
              <div className="flex items-center gap-1 text-rose-500 font-bold">
                <XCircle className="w-4 h-4" />
                <span>{mistakes}/3</span>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button 
                onClick={saveGame}
                title="Save Game"
                className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <Save className="w-5 h-5" />
              </button>
              <button 
                onClick={loadGame}
                title="Load Game"
                className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <Download className="w-5 h-5" />
              </button>
              <button 
                onClick={() => startNewGame()}
                title="New Game"
                className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center mb-4 px-1 text-[10px] uppercase tracking-wider font-bold text-slate-400">
          <span>Best: {formatTime(bestTimes[difficulty])}</span>
          <div className="flex items-center gap-1">
            <Lightbulb className="w-3 h-3" />
            <span>Hints: {MAX_HINTS - hintsUsed}</span>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-9 gap-0 border-2 border-indigo-900 rounded-lg overflow-hidden bg-indigo-900 shadow-inner relative">
          {grid.map((row, r) => (
            row.map((cell, c) => {
              const isSelected = selected?.r === r && selected?.c === c;
              const isInitial = initialGrid[r][c] !== null;
              const isHighlight = isRelated(r, c);
              const isSameValue = selected && grid[selected.r][selected.c] !== null && grid[selected.r][selected.c] === cell;

              return (
                <motion.div
                  key={`${r}-${c}`}
                  whileHover={!gameOver && !isInitial ? { scale: 1.05, zIndex: 10 } : {}}
                  onClick={() => handleCellClick(r, c)}
                  className={`
                    aspect-square flex items-center justify-center text-lg md:text-xl font-bold cursor-pointer transition-all duration-200
                    ${(r + 1) % 3 === 0 && r < 8 ? 'border-b-2 border-indigo-900' : 'border-b border-indigo-200/30'}
                    ${(c + 1) % 3 === 0 && c < 8 ? 'border-r-2 border-indigo-900' : 'border-r border-indigo-200/30'}
                    ${isInitial ? 'text-indigo-900 bg-slate-50' : 'text-indigo-600 bg-white'}
                    ${isHighlight ? 'bg-indigo-50' : ''}
                    ${isSelected ? '!bg-indigo-600 !text-white' : ''}
                    ${isSameValue ? 'bg-indigo-200' : ''}
                  `}
                >
                  {cell}
                </motion.div>
              );
            })
          ))}

          {/* Game Over Overlays */}
          <AnimatePresence>
            {gameOver && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="absolute inset-0 z-20 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center"
              >
                {gameOver === 'won' ? (
                  <>
                    <Trophy className="w-16 h-16 text-yellow-500 mb-4" />
                    <h2 className="text-2xl font-bold text-indigo-900 mb-2">Victory!</h2>
                    <p className="text-slate-600 mb-6">You've mastered the grid.</p>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
                    <h2 className="text-2xl font-bold text-indigo-900 mb-2">Game Over</h2>
                    <p className="text-slate-600 mb-6">Too many mistakes. Try again!</p>
                  </>
                )}
                <button
                  onClick={() => startNewGame()}
                  className="bg-indigo-600 text-white px-8 py-3 rounded-full font-bold shadow-lg hover:bg-indigo-700 transition-all active:scale-95"
                >
                  New Game
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Number Pad */}
        <div className="grid grid-cols-10 gap-2 mt-8">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <div key={num} className="flex flex-col items-center gap-1">
              <button
                onClick={() => handleNumberInput(num)}
                disabled={gameOver !== null || remaining[num] === 0}
                className={`
                  w-full aspect-square rounded-xl flex items-center justify-center font-bold text-lg shadow-sm transition-all active:scale-90
                  ${remaining[num] === 0 
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed' 
                    : 'bg-white border-2 border-indigo-100 text-indigo-600 hover:border-indigo-600 hover:bg-indigo-50'}
                `}
              >
                {num}
              </button>
              <span className={`text-[10px] font-bold ${remaining[num] === 0 ? 'text-slate-300' : 'text-slate-400'}`}>
                {remaining[num]}
              </span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={getHint}
              disabled={gameOver !== null || hintsUsed >= MAX_HINTS}
              className={`
                w-full aspect-square rounded-xl flex items-center justify-center font-bold text-lg shadow-sm transition-all active:scale-90
                ${hintsUsed >= MAX_HINTS 
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed' 
                  : 'bg-amber-50 border-2 border-amber-100 text-amber-600 hover:border-amber-600 hover:bg-amber-100'}
              `}
              title="Get Hint"
            >
              <Lightbulb className="w-6 h-6" />
            </button>
            <span className="text-[10px] font-bold text-slate-400">Hint</span>
          </div>
        </div>

        <p className="text-center text-slate-400 text-xs mt-8 font-medium uppercase tracking-widest">
          Remaining Numbers
        </p>
      </motion.div>

      <MusicPlayer />
    </div>
  );
}
